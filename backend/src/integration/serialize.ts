import type { Entity, EntityType } from "@mesa/contracts";
import type { Store } from "../database/store.js";
type Data = Record<string, unknown>;
export const tableMapping: Record<EntityType, string> = {
  settings: "restaurant_settings",
  product: "menu_products",
  order: "service_orders",
  order_item: "order_items",
  bill: "table_sessions",
  payment: "payments",
  refund: "refunds",
  ingredient: "ingredients",
  movement: "inventory_movements",
  supplier: "suppliers",
  purchase: "purchases",
  purchase_item: "purchase_items",
  receipt: "purchase_receipts",
  sponsor: "dashboard_sponsors",
  contribution: "dashboard_contributions",
  contribution_line: "dashboard_contribution_lines",
  equipment: "dashboard_equipment",
  ledger: "dashboard_cash_ledger",
  run: "simulation_runs",
};
const projections: Record<EntityType, string> = {
  settings:
    "SELECT CAST(s.id AS TEXT) id,s.name,s.time_zone AS timeZone,f.opening_cents AS openingBalanceCents FROM restaurant_settings s CROSS JOIN dashboard_finance_settings f WHERE s.id=?",
  product:
    "SELECT CAST(p.id AS TEXT) id,p.name,c.name AS category,p.price_cents AS priceCents,p.active FROM menu_products p JOIN categories c ON c.id=p.category_id WHERE p.id=?",
  order:
    "SELECT o.id,o.number,o.session_id AS billId,CAST(s.table_id AS TEXT) AS tableId,o.status,o.notes,o.created_at AS occurredAt FROM service_orders o JOIN table_sessions s ON s.id=o.session_id WHERE o.id=?",
  order_item:
    "SELECT i.id,i.order_id AS orderId,CAST(i.product_id AS TEXT) AS productId,i.name,c.name AS category,i.quantity,i.cancelled_quantity AS cancelledQuantity,i.price_cents AS priceCents FROM order_items i JOIN menu_products p ON p.id=i.product_id JOIN categories c ON c.id=p.category_id WHERE i.id=?",
  bill: "SELECT id,CAST(table_id AS TEXT) AS tableId,status,discount_cents AS discountCents,service_cents AS serviceCents,waived_cents AS waivedCents,opened_at AS openedAt,closed_at AS closedAt FROM table_sessions WHERE id=?",
  payment:
    "SELECT id,session_id AS billId,method,amount_cents AS amountCents,created_at AS occurredAt FROM payments WHERE id=?",
  refund:
    "SELECT id,payment_id AS paymentId,amount_cents AS amountCents,reason,created_at AS occurredAt FROM refunds WHERE id=?",
  ingredient:
    "SELECT i.id,i.name,i.unit,i.minimum,COALESCE((SELECT SUM(m.quantity) FROM inventory_movements m WHERE m.ingredient_id=i.id),0) AS physical,COALESCE((SELECT SUM(r.reserved_quantity) FROM inventory_reservations r WHERE r.ingredient_id=i.id),0) AS reserved,i.active FROM ingredients i WHERE i.id=?",
  movement:
    "SELECT id,ingredient_id AS ingredientId,kind,quantity,reserved_delta AS reservedDelta,waste_quantity AS wasteQuantity,source_id AS referenceId,reason,created_at AS occurredAt FROM inventory_movements WHERE id=?",
  supplier: "SELECT id,name,active FROM suppliers WHERE id=?",
  purchase:
    "SELECT id,supplier_id AS supplierId,supplier_name AS supplierName,status,notes,confirmed_at AS confirmedAt,created_at AS occurredAt FROM purchases WHERE id=?",
  purchase_item:
    "SELECT id,purchase_id AS purchaseId,ingredient_id AS ingredientId,ingredient_name AS name,unit,quantity,received_quantity AS receivedQuantity,total_cents AS totalCents,received_cents AS receivedCents FROM purchase_items WHERE id=?",
  receipt:
    "SELECT r.id,r.purchase_id AS purchaseId,COALESCE((SELECT SUM(i.total_cents) FROM purchase_receipt_items i WHERE i.receipt_id=r.id),0) AS totalCents,r.created_at AS occurredAt FROM purchase_receipts r WHERE r.id=?",
  sponsor: "SELECT id,name,active FROM dashboard_sponsors WHERE id=?",
  contribution:
    "SELECT id,sponsor_id AS sponsorId,cash_cents AS cashCents,valuation_cents AS valuationCents,status,notes,created_at AS occurredAt FROM dashboard_contributions WHERE id=?",
  contribution_line:
    "SELECT id,contribution_id AS contributionId,kind,ingredient_id AS ingredientId,name,quantity,valuation_cents AS valuationCents FROM dashboard_contribution_lines WHERE id=?",
  equipment:
    "SELECT id,contribution_id AS contributionId,name,quantity,valuation_cents AS valuationCents,active,created_at AS occurredAt FROM dashboard_equipment WHERE id=?",
  ledger:
    "SELECT id,kind,amount_cents AS amountCents,reference_id AS referenceId,reason,method,created_at AS occurredAt FROM dashboard_cash_ledger WHERE id=?",
  run: "SELECT id,status,config,elapsed_ms AS elapsedMs,created_at AS occurredAt FROM simulation_runs WHERE id=?",
};
export function serializeEntity(
  db: Store,
  type: EntityType,
  id: string,
): Entity | undefined {
  const data = db.get<Data>(projections[type], id);
  if (!data) return;
  if ("active" in data) data.active = !!data.active;
  if (type === "run") {
    data.config = JSON.parse(String(data.config)) as Record<string, unknown>;
    data.speed = (data.config as Record<string, unknown>).speed ?? 1;
  }
  if (type === "order_item") {
    const dataset = db.get<{ dataset_id: string }>(
      "SELECT dataset_id FROM dashboard_sync_meta WHERE id=1",
    )!.dataset_id;
    db.run(
      "INSERT OR IGNORE INTO dashboard_sync_item_categories VALUES(?,?,?)",
      dataset,
      id,
      String(data.category),
    );
    data.category = db.get<{ category: string }>(
      "SELECT category FROM dashboard_sync_item_categories WHERE dataset_id=? AND item_id=?",
      dataset,
      id,
    )!.category;
  }
  return { type, data } as Entity;
}
export function buildSyncSnapshot(db: Store): Entity[] {
  const result: Entity[] = [];
  for (const type of Object.keys(tableMapping) as EntityType[]) {
    for (const row of db.all<{ id: string }>(
      `SELECT CAST(id AS TEXT) id FROM ${tableMapping[type]} ORDER BY id`,
    )) {
      const e = serializeEntity(db, type, row.id);
      if (e) result.push(e);
    }
  }
  return result;
}

export function installDirtyTriggers(db: Store) {
  for (const [type, table] of Object.entries(tableMapping)) {
    if (type === "ledger") continue;
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      const row = operation === "DELETE" ? "OLD" : "NEW";
      let extra = "";
      if (type === "movement")
        extra += `INSERT OR IGNORE INTO dashboard_sync_dirty VALUES('ingredient',${row}.ingredient_id);`;
      if (type === "payment" || type === "refund")
        extra += `INSERT OR IGNORE INTO dashboard_sync_dirty VALUES('ledger','${type}:'||${row}.id);`;
      db.raw.exec(
        `CREATE TRIGGER IF NOT EXISTS dashboard_sync_${table}_${operation} AFTER ${operation} ON ${table} BEGIN INSERT OR IGNORE INTO dashboard_sync_dirty VALUES('${type}',CAST(${row}.id AS TEXT));${extra} END;`,
      );
    }
  }
  for (const [table, entity, key] of [
    ["inventory_reservations", "ingredient", "ingredient_id"],
    ["purchase_receipt_items", "receipt", "receipt_id"],
    ["dashboard_cash_entries", "ledger", "id"],
    ["dashboard_finance_settings", "settings", "id"],
  ] as const) {
    for (const op of ["INSERT", "UPDATE", "DELETE"]) {
      const row = op === "DELETE" ? "OLD" : "NEW";
      db.raw.exec(
        `CREATE TRIGGER IF NOT EXISTS dashboard_sync_${table}_${op} AFTER ${op} ON ${table} BEGIN INSERT OR IGNORE INTO dashboard_sync_dirty VALUES('${entity}',CAST(${row}.${key} AS TEXT)); END;`,
      );
    }
  }
  db.raw.exec(
    `CREATE TRIGGER IF NOT EXISTS dashboard_sync_categories AFTER UPDATE ON categories BEGIN INSERT OR IGNORE INTO dashboard_sync_dirty SELECT 'product',CAST(id AS TEXT) FROM menu_products WHERE category_id=NEW.id; END;`,
  );
}
