export const simulationSchema = `
CREATE TABLE IF NOT EXISTS simulation_metadata(id INTEGER PRIMARY KEY CHECK(id=1), label TEXT NOT NULL);
INSERT OR IGNORE INTO simulation_metadata VALUES(1,'training-only');
CREATE TABLE IF NOT EXISTS simulation_runs(id TEXT PRIMARY KEY,status TEXT NOT NULL,config TEXT NOT NULL,elapsed_ms INTEGER NOT NULL DEFAULT 0,base_time TEXT NOT NULL,prng INTEGER NOT NULL,next_arrival_ms INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS simulation_groups(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES simulation_runs(id),sequence INTEGER NOT NULL,size INTEGER NOT NULL,status TEXT NOT NULL,table_id INTEGER REFERENCES dining_tables(id),session_id TEXT REFERENCES table_sessions(id),order_id TEXT REFERENCES service_orders(id),waiter_id TEXT REFERENCES users(id),items TEXT NOT NULL,due_at INTEGER NOT NULL,error TEXT,UNIQUE(run_id,sequence));
CREATE INDEX IF NOT EXISTS simulation_group_run ON simulation_groups(run_id,status);
CREATE TABLE IF NOT EXISTS simulation_events(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES simulation_runs(id),virtual_time TEXT NOT NULL,message TEXT NOT NULL,type TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS simulation_events_run ON simulation_events(run_id,id);
INSERT OR IGNORE INTO schema_migrations VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;
