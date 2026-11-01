import { randomUUID } from "node:crypto";
import type {
  Ingredient,
  IngredientInput,
  IngredientUnit,
  InventoryAdjustment,
  InventoryMovement,
  InventoryMovementKind,
  Page,
  PremiumOrder,
  User,
} from "@restaurante/shared";
import { Store } from "../database/store.js";
import { HttpError } from "../errors.js";

export function requireAdmin(user: User) {
  if (!user.active || user.role !== "admin")
    throw new HttpError(403, "Operação restrita ao administrador.");
}
export function exactInteger(value: number, minimum = 0, maximum = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new HttpError(
      400,
      "Informe uma quantidade inteira dentro do limite permitido.",
    );
  return value;
}
export function requiredText(value: string, maximum = 500, minimum = 3) {
  if (
    typeof value !== "string" ||
    value.trim().length < minimum ||
    value.trim().length > maximum
  )
    throw new HttpError(
      400,
      `Informe um texto entre ${minimum} e ${maximum} caracteres.`,
    );
  return value.trim();
}
export function requestKey(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new HttpError(400, "Identificador de operação inválido.");
  return value;
}
/** Exact decimal conversion: no float multiplication or silent rounding. */
export function convertQuantity(
  value: string | number,
  from: IngredientUnit | "kg" | "l",
  to: IngredientUnit,
): number {
  const factor =
    from === to
      ? 1n
      : (from === "kg" && to === "g") || (from === "l" && to === "ml")
        ? 1000n
        : null;
  if (factor === null) throw new HttpError(400, "Unidades incompatíveis.");
  const text = String(value).trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text) || text.length > 30)
    throw new HttpError(400, "Quantidade inválida.");
  const [whole, fraction = ""] = text.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`) * factor;
  if (numerator % denominator !== 0n)
    throw new HttpError(400, "Precisão inferior à unidade base não é permitida.");
  const converted = numerator / denominator;
  if (converted > 1_000_000_000n)
    throw new HttpError(400, "Quantidade excede o limite permitido.");
  return Number(converted);
}

interface Reservation {
  id: string;
  order_item_id: string;
  ingredient_id: string;
  quantity_per_item: number;
  original_quantity: number;
  reserved_quantity: number;
  consumed_quantity: number;
  released_quantity: number;
  wasted_quantity: number;
  override_reason: string | null;
}
export class Inventory {
  constructor(readonly db: Store) {}
  stock(): Ingredient[] {
    return this.db
      .all<Omit<Ingredient, "active"> & { active: number }>(
        `
      SELECT i.id,i.name,i.unit,i.minimum,i.active,i.preferred_supplier_id AS preferredSupplierId,i.tracking_since AS trackingSince,
        COALESCE((SELECT SUM(m.quantity) FROM inventory_movements m WHERE m.ingredient_id=i.id),0) AS physical,
        COALESCE((SELECT SUM(r.reserved_quantity) FROM inventory_reservations r WHERE r.ingredient_id=i.id),0) AS reserved,
        COALESCE((SELECT SUM(m.quantity) FROM inventory_movements m WHERE m.ingredient_id=i.id),0)-
        COALESCE((SELECT SUM(r.reserved_quantity) FROM inventory_reservations r WHERE r.ingredient_id=i.id),0) AS available
      FROM ingredients i ORDER BY i.name
    `,
      )
      .map((i) => ({ ...i, active: !!i.active }));
  }
  ingredient(id: string): Ingredient {
    const row = this.stock().find((i) => i.id === id);
    if (!row) throw new HttpError(404, "Ingrediente não encontrado.");
    return row;
  }
  saveIngredient(user: User, input: IngredientInput, id?: string): Ingredient {
    requireAdmin(user);
    const name = requiredText(input.name, 120, 1),
      minimum = exactInteger(input.minimum);
    if (!["g", "ml", "un"].includes(input.unit) || typeof input.active !== "boolean")
      throw new HttpError(400, "Dados do ingrediente inválidos.");
    return this.db.tx(() => {
      const before = id ? this.ingredient(id) : null;
      if (before && before.unit !== input.unit)
        throw new HttpError(409, "A unidade base é imutável; crie outro ingrediente.");
      if (
        this.db.get("SELECT id FROM ingredients WHERE name=? AND id!=?", name, id ?? "")
      )
        throw new HttpError(409, "Nome de ingrediente já cadastrado.");
      const supplier = input.preferredSupplierId ?? null;
      if (
        supplier &&
        !this.db.get("SELECT id FROM suppliers WHERE id=? AND active=1", supplier)
      )
        throw new HttpError(400, "Fornecedor preferencial inválido ou inativo.");
      const ingredientId = id ?? randomUUID();
      this.db.run(
        `INSERT INTO ingredients(id,name,unit,minimum,active,preferred_supplier_id,tracking_since) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,minimum=excluded.minimum,active=excluded.active,preferred_supplier_id=excluded.preferred_supplier_id`,
        ingredientId,
        name,
        input.unit,
        minimum,
        Number(input.active),
        supplier,
        this.db.timestamp(),
      );
      if (supplier)
        this.db.run(
          "INSERT OR IGNORE INTO supplier_ingredients VALUES(?,?)",
          supplier,
          ingredientId,
        );
      this.db.audit(user.id, "ingredient.saved", ingredientId, { before, after: input });
      return this.ingredient(ingredientId);
    });
  }
  movements(
    query: { page?: number; ingredientId?: string } = {},
  ): Page<InventoryMovement> {
    const page = exactInteger(query.page ?? 1, 1, 1_000_000),
      pageSize = 50;
    const filter = query.ingredientId ? "WHERE m.ingredient_id=?" : "";
    const params = query.ingredientId ? [query.ingredientId] : [];
    const total = this.db.get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM inventory_movements m ${filter}`,
      ...params,
    )!.total;
    const items = this.db.all<InventoryMovement>(
      `SELECT m.id,m.ingredient_id AS ingredientId,i.name AS ingredientName,i.unit,m.kind,m.quantity,m.reserved_delta AS reservedDelta,m.waste_quantity AS wasteQuantity,m.reason,m.source_id AS sourceId,u.name AS userName,m.created_at AS createdAt FROM inventory_movements m JOIN ingredients i ON i.id=m.ingredient_id JOIN users u ON u.id=m.user_id ${filter} ORDER BY m.created_at DESC,m.rowid DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );
    return { items, total, page, pageSize };
  }
  /** Must run in the caller's transaction when used by a larger operation. */
  record(
    user: User,
    ingredientId: string,
    kind: InventoryMovementKind,
    quantity: number,
    reservedDelta: number,
    wasteQuantity: number,
    sourceId: string,
    reason: string,
  ) {
    this.db.run(
      "INSERT INTO inventory_movements(id,ingredient_id,kind,quantity,reserved_delta,waste_quantity,source_id,reason,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      randomUUID(),
      ingredientId,
      kind,
      quantity,
      reservedDelta,
      wasteQuantity,
      sourceId,
      reason,
      user.id,
      this.db.timestamp(),
    );
  }
  adjust(user: User, input: InventoryAdjustment) {
    requireAdmin(user);
    requestKey(input.requestId);
    exactInteger(input.quantity, -1_000_000_000);
    if (!input.quantity || !["initial", "adjustment", "loss"].includes(input.kind))
      throw new HttpError(400, "Movimentação inválida.");
    if (
      (input.kind === "initial" && input.quantity < 0) ||
      (input.kind === "loss" && input.quantity > 0)
    )
      throw new HttpError(400, "Entrada deve ser positiva; perda deve ser negativa.");
    const reason = requiredText(input.reason);
    if (input.overrideReason !== undefined) requiredText(input.overrideReason);
    return this.db.operation(user.id, input.requestId, "inventory.adjust", input, () => {
      const before = this.ingredient(input.ingredientId);
      if (
        input.kind === "initial" &&
        this.db.get("SELECT id FROM inventory_movements WHERE ingredient_id=?", before.id)
      )
        throw new HttpError(409, "Inventário inicial já registrado; utilize ajuste.");
      if (before.available + input.quantity < 0 && !input.overrideReason)
        throw new HttpError(
          409,
          "A movimentação cria déficit diante das reservas. Informe justificativa administrativa.",
          "INSUFFICIENT_STOCK",
        );
      this.record(
        user,
        before.id,
        input.kind,
        input.quantity,
        0,
        input.kind === "loss" ? -input.quantity : 0,
        input.requestId,
        reason,
      );
      if (before.available + input.quantity < 0 && input.overrideReason)
        this.db.run(
          "UPDATE inventory_reservations SET override_reason=COALESCE(override_reason,?) WHERE ingredient_id=? AND reserved_quantity>0",
          input.overrideReason,
          before.id,
        );
      this.db.audit(user.id, "inventory.adjusted", before.id, {
        ...input,
        before,
        after: this.ingredient(before.id),
      });
      return this.ingredient(before.id);
    });
  }
  availability(productId: number): {
    tracked: boolean;
    available: boolean;
    maximum: number | null;
  } {
    const recipe = this.db.get<{ id: string; active: number }>(
      "SELECT id,active FROM recipe_versions WHERE product_id=? ORDER BY version DESC LIMIT 1",
      productId,
    );
    if (!recipe?.active) return { tracked: false, available: true, maximum: null };
    const items = this.db.all<{ ingredient_id: string; quantity: number }>(
      "SELECT ingredient_id,quantity FROM recipe_items WHERE recipe_id=?",
      recipe.id,
    );
    const stock = this.stock();
    const maximum = Math.max(
      0,
      Math.min(
        ...items.map((item) => {
          const ingredient = stock.find((i) => i.id === item.ingredient_id);
          return ingredient?.active
            ? Math.floor(ingredient.available / item.quantity)
            : 0;
        }),
      ),
    );
    return {
      tracked: true,
      available: maximum > 0,
      maximum: Number.isFinite(maximum) ? maximum : 0,
    };
  }
  reserve(user: User, order: PremiumOrder, overrideReason?: string) {
    if (overrideReason !== undefined) {
      requireAdmin(user);
      requiredText(overrideReason);
    }
    const pending: {
      itemId: string;
      recipeId: string;
      ingredientId: string;
      perItem: number;
      quantity: number;
    }[] = [];
    for (const item of order.items) {
      if (
        this.db.get(
          "SELECT order_item_id FROM order_recipe_snapshots WHERE order_item_id=?",
          item.id,
        )
      )
        continue;
      const recipe = this.db.get<{ id: string; active: number }>(
        "SELECT id,active FROM recipe_versions WHERE product_id=? ORDER BY version DESC LIMIT 1",
        item.productId,
      );
      this.db.run(
        "INSERT INTO order_recipe_snapshots VALUES(?,?,?)",
        item.id,
        recipe?.active ? recipe.id : null,
        this.db.timestamp(),
      );
      if (!recipe?.active) continue;
      const recipeItems = this.db.all<{ ingredient_id: string; quantity: number }>(
        "SELECT ingredient_id,quantity FROM recipe_items WHERE recipe_id=?",
        recipe.id,
      );
      for (const ri of recipeItems)
        pending.push({
          itemId: item.id,
          recipeId: recipe.id,
          ingredientId: ri.ingredient_id,
          perItem: ri.quantity,
          quantity: exactInteger(
            ri.quantity * (item.quantity - item.cancelledQuantity),
            1,
            100_000_000_000,
          ),
        });
    }
    const stock = this.stock();
    const needs = new Map<string, number>();
    for (const p of pending)
      needs.set(p.ingredientId, (needs.get(p.ingredientId) ?? 0) + p.quantity);
    const deficits: { ingredientId: string; quantity: number; available: number }[] = [];
    for (const [id, quantity] of needs) {
      const ingredient = stock.find((i) => i.id === id);
      if (!ingredient?.active)
        throw new HttpError(409, "Há ingrediente inativo na ficha técnica.");
      if (ingredient.available < quantity)
        deficits.push({ ingredientId: id, quantity, available: ingredient.available });
    }
    if (deficits.length && !overrideReason)
      throw new HttpError(
        409,
        "Ingredientes insuficientes para confirmar o pedido.",
        "INSUFFICIENT_STOCK",
      );
    // The authorization covers this ingredient's existing reservations as well:
    // preparation order must not decide which valid order can use the approved deficit.
    if (overrideReason)
      for (const deficit of deficits)
        this.db.run(
          "UPDATE inventory_reservations SET override_reason=COALESCE(override_reason,?) WHERE ingredient_id=? AND reserved_quantity>0",
          overrideReason,
          deficit.ingredientId,
        );
    for (const p of pending) {
      const id = randomUUID();
      this.db.run(
        "INSERT INTO inventory_reservations(id,order_item_id,ingredient_id,recipe_id,quantity_per_item,original_quantity,reserved_quantity,override_reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        id,
        p.itemId,
        p.ingredientId,
        p.recipeId,
        p.perItem,
        p.quantity,
        p.quantity,
        overrideReason ?? null,
        this.db.timestamp(),
      );
      this.record(
        user,
        p.ingredientId,
        "reserve",
        0,
        p.quantity,
        0,
        id,
        `Reserva do pedido #${order.number}`,
      );
    }
    if (deficits.length)
      this.db.audit(user.id, "inventory.shortage_authorized", order.id, {
        reason: overrideReason,
        deficits,
      });
  }
  consume(user: User, order: PremiumOrder) {
    const reservations = this.db.all<Reservation>(
      "SELECT r.* FROM inventory_reservations r JOIN order_items oi ON oi.id=r.order_item_id WHERE oi.order_id=? AND r.reserved_quantity>0",
      order.id,
    );
    for (const r of reservations) {
      const physical = this.ingredient(r.ingredient_id).physical;
      if (physical < r.reserved_quantity && !r.override_reason)
        throw new HttpError(
          409,
          "Estoque físico insuficiente para iniciar preparo; requer tratamento administrativo.",
          "INSUFFICIENT_STOCK",
        );
      this.db.run(
        "UPDATE inventory_reservations SET consumed_quantity=consumed_quantity+reserved_quantity,reserved_quantity=0 WHERE id=?",
        r.id,
      );
      this.record(
        user,
        r.ingredient_id,
        "consume",
        -r.reserved_quantity,
        -r.reserved_quantity,
        0,
        r.id,
        `Preparo do pedido #${order.number}`,
      );
    }
  }
  /** Pass the ORIGINAL order, before applying this cancellation's cancelledQuantity. */
  cancel(
    user: User,
    order: PremiumOrder,
    items: { itemId: string; quantity: number }[],
    reason: string,
  ) {
    for (const item of items) {
      const original = order.items.find((i) => i.id === item.itemId);
      if (
        !original ||
        item.quantity < 1 ||
        item.quantity > original.quantity - original.cancelledQuantity
      )
        throw new HttpError(409, "Quantidade de cancelamento inválida.");
      const rows = this.db.all<Reservation>(
        "SELECT * FROM inventory_reservations WHERE order_item_id=?",
        item.itemId,
      );
      for (const r of rows) {
        const target = (original.cancelledQuantity + item.quantity) * r.quantity_per_item;
        const delta = target - r.released_quantity - r.wasted_quantity;
        if (delta <= 0) continue;
        if (r.reserved_quantity > 0) {
          if (delta > r.reserved_quantity)
            throw new HttpError(409, "Cancelamento excede a reserva do ingrediente.");
          this.db.run(
            "UPDATE inventory_reservations SET reserved_quantity=reserved_quantity-?,released_quantity=released_quantity+? WHERE id=?",
            delta,
            delta,
            r.id,
          );
          this.record(
            user,
            r.ingredient_id,
            "release",
            0,
            -delta,
            0,
            `${r.id}:${target}`,
            reason,
          );
        } else {
          if (delta > r.consumed_quantity - r.wasted_quantity)
            throw new HttpError(409, "Cancelamento excede o consumo válido.");
          this.db.run(
            "UPDATE inventory_reservations SET wasted_quantity=wasted_quantity+? WHERE id=?",
            delta,
            r.id,
          );
          this.record(
            user,
            r.ingredient_id,
            "waste",
            0,
            0,
            delta,
            `${r.id}:${target}`,
            reason,
          );
        }
      }
    }
  }
}
