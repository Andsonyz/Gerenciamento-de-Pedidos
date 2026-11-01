/** Version 3: additive migration; existing products remain untracked until configured. */
export const operationsSchema = `
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL CHECK(active IN (0,1)), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  unit TEXT NOT NULL CHECK(unit IN ('g','ml','un')), minimum INTEGER NOT NULL CHECK(minimum>=0),
  active INTEGER NOT NULL CHECK(active IN (0,1)), preferred_supplier_id TEXT REFERENCES suppliers(id), tracking_since TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_ingredients (
  supplier_id TEXT NOT NULL REFERENCES suppliers(id), ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  PRIMARY KEY(supplier_id,ingredient_id)
);
CREATE TABLE IF NOT EXISTS recipe_versions (
  id TEXT PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES menu_products(id), version INTEGER NOT NULL CHECK(version>0),
  active INTEGER NOT NULL CHECK(active IN (0,1)), created_at TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  UNIQUE(product_id,version)
);
CREATE INDEX IF NOT EXISTS recipes_product ON recipe_versions(product_id,version DESC);
CREATE TABLE IF NOT EXISTS recipe_items (
  recipe_id TEXT NOT NULL REFERENCES recipe_versions(id), ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  quantity INTEGER NOT NULL CHECK(quantity>0), PRIMARY KEY(recipe_id,ingredient_id)
);
CREATE TABLE IF NOT EXISTS order_recipe_snapshots (
  order_item_id TEXT PRIMARY KEY REFERENCES order_items(id), recipe_id TEXT REFERENCES recipe_versions(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id TEXT PRIMARY KEY, order_item_id TEXT NOT NULL REFERENCES order_items(id), ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  recipe_id TEXT NOT NULL REFERENCES recipe_versions(id), quantity_per_item INTEGER NOT NULL CHECK(quantity_per_item>0),
  original_quantity INTEGER NOT NULL CHECK(original_quantity>0), reserved_quantity INTEGER NOT NULL CHECK(reserved_quantity>=0),
  consumed_quantity INTEGER NOT NULL DEFAULT 0 CHECK(consumed_quantity>=0), released_quantity INTEGER NOT NULL DEFAULT 0 CHECK(released_quantity>=0),
  wasted_quantity INTEGER NOT NULL DEFAULT 0 CHECK(wasted_quantity>=0 AND wasted_quantity<=consumed_quantity),
  override_reason TEXT, created_at TEXT NOT NULL, UNIQUE(order_item_id,ingredient_id),
  CHECK(original_quantity=reserved_quantity+consumed_quantity+released_quantity)
);
CREATE INDEX IF NOT EXISTS reservations_ingredient ON inventory_reservations(ingredient_id,reserved_quantity);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  kind TEXT NOT NULL CHECK(kind IN ('initial','adjustment','loss','reserve','release','consume','waste','receipt')),
  quantity INTEGER NOT NULL, reserved_delta INTEGER NOT NULL DEFAULT 0, waste_quantity INTEGER NOT NULL DEFAULT 0 CHECK(waste_quantity>=0),
  source_id TEXT NOT NULL, reason TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  UNIQUE(ingredient_id,kind,source_id)
);
CREATE INDEX IF NOT EXISTS movements_ingredient_time ON inventory_movements(ingredient_id,created_at);
CREATE INDEX IF NOT EXISTS movements_time_kind ON inventory_movements(created_at,kind);
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), supplier_name TEXT NOT NULL, notes TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','confirmed','partially_received','received','cancelled')),
  created_at TEXT NOT NULL, confirmed_at TEXT, cancelled_at TEXT, cancellation_reason TEXT, user_id TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS purchases_status ON purchases(status,created_at);
CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES purchases(id), ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  ingredient_name TEXT NOT NULL, unit TEXT NOT NULL CHECK(unit IN ('g','ml','un')), quantity INTEGER NOT NULL CHECK(quantity>0),
  total_cents INTEGER NOT NULL CHECK(total_cents>=0), received_quantity INTEGER NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=quantity),
  received_cents INTEGER NOT NULL DEFAULT 0 CHECK(received_cents>=0 AND received_cents<=total_cents),
  UNIQUE(purchase_id,ingredient_id)
);
CREATE INDEX IF NOT EXISTS purchase_items_purchase ON purchase_items(purchase_id);
CREATE TABLE IF NOT EXISTS purchase_receipts (
  id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES purchases(id), user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_receipt_items (
  receipt_id TEXT NOT NULL REFERENCES purchase_receipts(id), item_id TEXT NOT NULL REFERENCES purchase_items(id),
  quantity INTEGER NOT NULL CHECK(quantity>0), total_cents INTEGER NOT NULL CHECK(total_cents>=0), PRIMARY KEY(receipt_id,item_id)
);
`;
