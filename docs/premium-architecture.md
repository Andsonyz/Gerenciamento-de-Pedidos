# Evolução premium — arquitetura e contrato

Decisões de 29/10/2026. A estrutura `backend`, `frontend`, `shared` permanece: já separa responsabilidades e evita uma mudança de diretórios sem benefício operacional. SQLite usa o driver nativo do Node 24; Prisma não é necessário para este servidor único. A versão anterior será migrada sem apagar os pedidos originais.

## Regras

- Uma sessão aberta por mesa; preços e nomes são copiados para cada item confirmado.
- Operações críticas usam transação imediata, chave idempotente, valores inteiros em centavos e auditoria.
- Cancelamento normal é bloqueado se houver pagamentos líquidos. O administrador pode registrar estorno manual separado, com justificativa; isso não executa transação bancária.
- Sessões encerradas são imutáveis para novos pedidos. Encerramento excepcional é exclusivo do administrador e registra a baixa do saldo.
- Cookies de sessão opacos, hash de senha scrypt, expiração, CSRF e autorização por papel no servidor. Nenhuma senha padrão. Configuração inicial por comando local.
- Socket.IO envia notificações autenticadas por papel. Cada cliente recarrega o estado autorizado por REST; SQLite é a fonte de verdade.
- Fila de impressão persistida na mesma transação do pedido/cancelamento. Cozinha recebe somente dados operacionais, sem preços. Reimpressão cria trabalho novo identificado, sem duplicar o pedido.
- PWA armazena somente recursos estáticos; rascunhos locais não são pedidos confirmados. Instalação e service worker exigem contexto seguro (HTTPS ou localhost).

## API (todas as rotas abaixo têm prefixo `/api`)

Respostas usam os tipos de `shared/src/premium.ts`. Erros: `{error: string}`. POST/PATCH usam JSON e header `X-CSRF-Token` retornado por login/me. Cookies são enviados com as requisições. IDs de operações críticas são UUIDs.

| Método e rota                             | Entrada / resposta                                             | Papéis                         |
| ----------------------------------------- | -------------------------------------------------------------- | ------------------------------ |
| POST /auth/login                          | `{username,password}` → AuthSession                            | público                        |
| GET /auth/me                              | AuthSession                                                    | autenticado                    |
| POST /auth/logout                         | `{}`                                                           | autenticado                    |
| GET /tables                               | DiningTable[]                                                  | todos                          |
| POST /tables/:id/open                     | `{requestId}` → Bill                                           | admin/caixa/garçom             |
| PATCH /tables/:id                         | status: available, reserved ou unavailable                     | admin/caixa                    |
| GET /sessions                             | Bill[] (histórico)                                             | admin/caixa                    |
| GET /sessions/:id                         | Bill                                                           | admin/caixa                    |
| POST /sessions/:id/request-close          | `{}` → Bill                                                    | admin/caixa/garçom             |
| PATCH /sessions/:id/adjustments           | `{discountCents,serviceCents,reason}` → Bill                   | admin                          |
| POST /sessions/:id/close                  | `{requestId,exceptional?:boolean,reason?:string}` → Bill       | admin/caixa (exceção admin)    |
| POST /sessions/:id/payments               | `{requestId,method,amountCents,tenderedCents?}` → Bill         | admin/caixa                    |
| POST /payments/:id/refund                 | `{requestId,amountCents,reason}` → Bill                        | admin                          |
| GET /products                             | CatalogProduct[] (inativos somente admin)                      | admin/caixa/garçom             |
| POST /products; PATCH /products/:id       | `{name,category,priceCents,active,available}` → CatalogProduct | admin                          |
| GET /categories                           | Category[]                                                     | admin/caixa/garçom             |
| POST /categories                          | `{name}` → Category                                            | admin                          |
| GET /orders                               | PremiumOrder[] (garçom: próprios)                              | admin/caixa/garçom             |
| POST /orders                              | CreateOrder com sessionId obrigatório → PremiumOrder (201/200) | admin/caixa/garçom             |
| PATCH /orders/:id/status                  | `{status:'preparing'                                           | 'ready'                        | 'delivered'}` | admin/caixa/cozinha |
| POST /orders/:id/cancellation-requests    | CancellationInput → CancellationRequest                        | admin/caixa/garçom (próprios)  |
| POST /orders/:id/cancel                   | CancellationInput → PremiumOrder                               | admin/caixa                    |
| GET /cancellation-requests                | CancellationRequest[] (garçom: próprias)                       | admin/caixa/garçom             |
| POST /cancellation-requests/:id/resolve   | `{approve,reason,acknowledged?:boolean}` → CancellationRequest | admin/caixa                    |
| GET /print-jobs                           | PrintJob[]                                                     | admin/cozinha                  |
| PATCH /print-jobs/:id                     | status: displayed ou failed → PrintJob                         | admin/cozinha                  |
| POST /print-jobs/:id/reprint              | `{requestId,reason}` → PrintJob                                | admin/cozinha                  |
| GET /dashboard                            | Dashboard                                                      | admin/caixa                    |
| GET /audit                                | AuditEntry[]                                                   | admin                          |
| GET /users; POST /users; PATCH /users/:id | User[]; UserInput → User                                       | admin                          |
| GET /settings; PATCH /settings            | RestaurantSettings                                             | leitura todos, alteração admin |

`CancellationInput`: `{requestId,reason,items:[{itemId,quantity}],acknowledged?:boolean}`; todos os itens válidos significam cancelamento total. Confirmação adicional obrigatória em preparo/pronto. Pagamento/reimpressão/abertura/envio/cancelamento/estorno/fechamento reutilizam requestId nas tentativas incertas.

Socket conecta com cookie e `auth:{csrfToken}`. Evento `state:changed` com `{id,scope}`; atualizar recursos por REST. Não se inscreve em salas escolhidas pelo cliente. Logout e desativação revogam sessões.

Nas rotas de abertura/solicitação de fechamento, o garçom recebe somente `{id,tableId,status}`. As respostas completas de contas e os pagamentos são restritos ao caixa/administrador. Conflitos de negócio transacionados retornam código `BUSINESS_CONFLICT`; conflito de identificador retorna `REQUEST_ID_CONFLICT`, para preservar operações incertas no cliente.

## Plano de execução e registro

1. Diagnóstico: concluído; 21 testes existentes passaram. Branch existente `feat/restaurante-mvp`, sem mudanças locais no início.
2. Concluído: contratos, migrações, autenticação, catálogo e configuração inicial.
3. Concluído: pedidos/sessões, cancelamentos, finanças e fila persistente; testes de integração.
4. Concluído: interface premium responsiva, permissões, formulários, recuperação e PWA.
5. Concluído: verificação cruzada, Playwright, lint/tipagem/build, documentação Windows e limitações. Evidências em [verificação premium](premium-verification.md).

Referências verificadas: [SQLite Node 24](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html), [middleware Socket.IO](https://socket.io/docs/v4/middlewares/), [salas](https://socket.io/docs/v4/rooms/), [React Router](https://reactrouter.com/start/declarative/installation), [Lucide](https://lucide.dev/guide/react), [PWA e HTTPS](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [ESLint](https://eslint.org/docs/latest/use/configure/configuration-files), [Supertest](https://github.com/forwardemail/supertest).
