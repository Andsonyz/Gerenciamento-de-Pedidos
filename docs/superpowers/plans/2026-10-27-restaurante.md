# Restaurante MVP Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Entregar MVP local funcional de pedidos e impressora virtual.
**Architecture:** workspaces compartilhados; API transacional; impressão por adaptador e snapshots persistentes.
**Tech Stack:** TypeScript estrito, React, Vite, Tailwind, Express, Socket.IO, SQLite, npm.
**Spec:** ../specs/2026-10-27-restaurante-design.md

## Global Constraints

Windows e LAN; sem nuvem em execução, ESC/POS ou finanças avançadas. Não declarar testes não executados.

## Review Focus

Resposta perdida após persistência; mesma chave simultânea; pedidos enquanto impressora fechada; status antigo durante reconexão; UUID em celular HTTP sem secure context.

## Task 1 — API e persistência

- [x] Configurar workspaces e testes de integração em backend/tests/orders.test.ts.
- [x] Executar testes antes da implementação e registrar falha por comportamento ausente.
- [x] Implementar shared/src/index.ts, backend/src/{app,database,orders,validation,index}.ts e printing/{PrinterAdapter,VirtualPrinterAdapter}.ts.
- [x] Testar criação, validação, reenvio/conflito, 20 pedidos simultâneos, reinício, estado e reconexão via socket real.

## Task 2 — Interface e recuperação

- [x] Escrever testes de navegador em e2e/restaurant.spec.ts e executá-los antes da UI.
- [x] Implementar frontend/src/{App,Waiter,Printer,Receipt}.tsx e {api,usePrinter,submission}.ts.
- [x] Testar fluxo de garçom em viewport móvel, falha/reconexão, impressora fechada, status persistido e ausência de duplicação.

## Task 3 — Entrega

- [x] Documentar Windows/VS Code, comandos separados/conjuntos, IP/firewall, endpoints e limites no README.
- [x] Executar npm test, npm run typecheck, npm run build e npm run test:e2e.
- [x] Revisar diff e registrar evidências/limites de teste.

## Registro de execução

Implementação na branch feat/restaurante-mvp no diretório visível ao usuário; sem commits automáticos ou publicação. O escopo detalhado já autoriza a implementação; escolhas técnicas documentadas sem exigir nova aprovação.

Task 1: complete — 18 testes de integração passaram.
Task 2: complete — 3 testes de lógica e 5 E2E passaram, incluindo regressão entre abas.
Task 3: complete — npm ci, typecheck, build, audit e inicialização real dev/compilada verificados. Evidências e limitações em ../../verification.md.

Ruling: armazenamento separado por requestId — revisão reproduziu perda da pendência entre abas; registro único por pedido elimina sobrescrita e remoção cruzadas.
