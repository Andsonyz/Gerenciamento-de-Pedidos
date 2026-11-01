import { randomUUID } from "node:crypto";
import type { IngredientUnit, User } from "@restaurante/shared";
import { Store } from "../database/store.js";
import { Inventory } from "./inventory.js";
import { Recipes } from "./recipes.js";
import { Purchasing } from "./purchasing.js";

/** Called only for the isolated training database. It never replenishes existing inventory. */
export function seedSimulationInventory(db: Store) {
  const row = db.get<Omit<User, "active"> & { active: number }>(
    "SELECT id,username,name,role,active FROM users WHERE role='admin' AND active=1 ORDER BY created_at LIMIT 1",
  );
  if (!row)
    throw new Error("Prepare os usuários da simulação antes do estoque demonstrativo.");
  const admin: User = { ...row, active: !!row.active };
  const inventory = new Inventory(db),
    recipes = new Recipes(db),
    purchasing = new Purchasing(db);
  const supplierName = "[Simulação] Abastecimento de demonstração";
  const supplier =
    purchasing.listSuppliers().find((s) => s.name === supplierName) ??
    purchasing.saveSupplier(admin, {
      name: supplierName,
      phone: "",
      email: "",
      active: true,
      ingredientIds: [],
    });
  const definitions: Record<
    string,
    { name: string; unit: IngredientUnit; stock: number; minimum: number }
  > = {
    meat: { name: "Carne bovina", unit: "g", stock: 100000, minimum: 5000 },
    chicken: { name: "Frango", unit: "g", stock: 100000, minimum: 5000 },
    vegetables: { name: "Hortaliças", unit: "g", stock: 100000, minimum: 5000 },
    potatoes: { name: "Batata", unit: "g", stock: 100000, minimum: 5000 },
    juice: {
      name: "Suco de laranja preparado",
      unit: "ml",
      stock: 100000,
      minimum: 5000,
    },
    water: { name: "Água mineral embalada", unit: "un", stock: 500, minimum: 24 },
    soda: { name: "Refrigerante lata", unit: "un", stock: 500, minimum: 24 },
    dessert: { name: "Pudim porcionado", unit: "un", stock: 500, minimum: 20 },
    bread: { name: "Pão de hambúrguer", unit: "un", stock: 500, minimum: 20 },
  };
  const ids = new Map<string, string>();
  for (const [key, definition] of Object.entries(definitions)) {
    const name = `[Simulação] ${definition.name}`;
    const ingredient =
      inventory.stock().find((i) => i.name === name) ??
      inventory.saveIngredient(admin, {
        name,
        unit: definition.unit,
        minimum: definition.minimum,
        active: true,
        preferredSupplierId: supplier.id,
      });
    if (
      !db.get("SELECT id FROM inventory_movements WHERE ingredient_id=?", ingredient.id)
    )
      inventory.adjust(admin, {
        requestId: randomUUID(),
        ingredientId: ingredient.id,
        quantity: definition.stock,
        kind: "initial",
        reason: "Saldo inicial fictício do ambiente de treinamento",
      });
    ids.set(key, ingredient.id);
  }
  const productRecipes: Record<number, [string, number][]> = {
    1: [
      ["meat", 180],
      ["bread", 1],
      ["vegetables", 50],
    ],
    2: [
      ["chicken", 220],
      ["vegetables", 60],
    ],
    3: [["vegetables", 250]],
    4: [["potatoes", 200]],
    5: [["juice", 300]],
    6: [["water", 1]],
    7: [["soda", 1]],
    8: [["dessert", 1]],
  };
  for (const product of db.all<{ id: number; name: string }>(
    "SELECT id,name FROM menu_products WHERE active=1",
  )) {
    if (recipes.current(product.id)) continue;
    const mapped = productRecipes[product.id];
    if (mapped)
      recipes.save(admin, product.id, {
        active: true,
        items: mapped.map(([key, quantity]) => ({
          ingredientId: ids.get(key)!,
          quantity,
        })),
      });
    else {
      const name = `[Simulação] Porção preparada de ${product.name}`.slice(0, 120);
      const ingredient =
        inventory.stock().find((i) => i.name === name) ??
        inventory.saveIngredient(admin, {
          name,
          unit: "un",
          minimum: 20,
          active: true,
          preferredSupplierId: supplier.id,
        });
      if (
        !db.get("SELECT id FROM inventory_movements WHERE ingredient_id=?", ingredient.id)
      )
        inventory.adjust(admin, {
          requestId: randomUUID(),
          ingredientId: ingredient.id,
          quantity: 500,
          kind: "initial",
          reason: "Saldo fictício de porções para treinamento",
        });
      recipes.save(admin, product.id, {
        active: true,
        items: [{ ingredientId: ingredient.id, quantity: 1 }],
      });
    }
  }
}
