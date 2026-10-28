import { Waiter } from "./Waiter";
import { Printer } from "./Printer";
export function App() {
  const isPrinter = window.location.pathname === "/impressora";
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <a href="/" className="brand" aria-label="Mesa — início">
            mesa<span>.</span>
          </a>
          <span className="brand-divider" />
          <span className="brand-caption">Pedidos, sem complicar.</span>
          <nav aria-label="Navegação principal">
            <a href="/" aria-current={!isPrinter ? "page" : undefined}>
              Garçom
            </a>
            <a href="/impressora" aria-current={isPrinter ? "page" : undefined}>
              Impressora Virtual
            </a>
          </nav>
          <span className="lan-badge">
            <i />
            Rede local
          </span>
        </div>
      </header>
      <main>{isPrinter ? <Printer /> : <Waiter />}</main>
      <footer className="app-footer">
        <span className="font-semibold">mesa.</span>
        <span>Do salão à cozinha, na mesma rede.</span>
        <span>MVP / 01</span>
      </footer>
    </div>
  );
}
