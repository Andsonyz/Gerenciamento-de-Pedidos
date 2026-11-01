import { randomUUID } from "node:crypto";
import type { RecipeInput, RecipeVersion, User } from "@restaurante/shared";
import { Store } from "../database/store.js";
import { HttpError } from "../errors.js";
import { exactInteger, requireAdmin } from "./inventory.js";

export class Recipes {
  constructor(readonly db: Store) {}
  get(productId: number): RecipeVersion[] {
    if (!this.db.get("SELECT id FROM menu_products WHERE id=?", productId))
      throw new HttpError(404, "Produto não encontrado.");
    return this.db
      .all<Omit<RecipeVersion, "items" | "active"> & { active: number }>(
        "SELECT id,product_id AS productId,version,active,created_at AS createdAt FROM recipe_versions WHERE product_id=? ORDER BY version DESC",
        productId,
      )
      .map((r) => ({
        ...r,
        active: !!r.active,
        items: this.db.all<RecipeVersion["items"][number]>(
          "SELECT ri.ingredient_id AS ingredientId,i.name,i.unit,ri.quantity FROM recipe_items ri JOIN ingredients i ON i.id=ri.ingredient_id WHERE ri.recipe_id=? ORDER BY i.name",
          r.id,
        ),
      }));
  }
  current(productId: number): RecipeVersion | null {
    return this.get(productId)[0] ?? null;
  }
  save(user: User, productId: number, input: RecipeInput): RecipeVersion {
    requireAdmin(user);
    if (
      typeof input.active !== "boolean" ||
      !Array.isArray(input.items) ||
      input.items.length > 100 ||
      (input.active && !input.items.length)
    )
      throw new HttpError(400, "Informe os ingredientes da ficha técnica ativa.");
    if (new Set(input.items.map((i) => i.ingredientId)).size !== input.items.length)
      throw new HttpError(400, "Ingrediente repetido na ficha técnica.");
    return this.db.tx(() => {
      const current = this.current(productId);
      for (const item of input.items) {
        exactInteger(item.quantity, 1);
        const ingredient = this.db.get<{ active: number }>(
          "SELECT active FROM ingredients WHERE id=?",
          item.ingredientId,
        );
        if (!ingredient || (input.active && !ingredient.active))
          throw new HttpError(400, "Ingrediente inexistente ou inativo.");
        if (
          input.active &&
          !this.db.get(
            "SELECT ri.ingredient_id FROM recipe_items ri JOIN recipe_versions rv ON rv.id=ri.recipe_id WHERE ri.ingredient_id=? AND rv.active=1 LIMIT 1",
            item.ingredientId,
          )
        )
          this.db.run(
            "UPDATE ingredients SET tracking_since=? WHERE id=?",
            this.db.timestamp(),
            item.ingredientId,
          );
      }
      const id = randomUUID();
      this.db.run(
        "INSERT INTO recipe_versions(id,product_id,version,active,created_at,user_id) VALUES(?,?,?,?,?,?)",
        id,
        productId,
        (current?.version ?? 0) + 1,
        Number(input.active),
        this.db.timestamp(),
        user.id,
      );
      for (const item of input.items)
        this.db.run(
          "INSERT INTO recipe_items VALUES(?,?,?)",
          id,
          item.ingredientId,
          item.quantity,
        );
      this.db.audit(user.id, "recipe.version_created", id, {
        productId,
        before: current,
        after: input,
      });
      return this.current(productId)!;
    });
  }
}
