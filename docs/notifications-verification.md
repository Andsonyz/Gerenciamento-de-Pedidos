# Notificações de atendimento

Implementado em 01/11/2026.

- Indicadores **!** nas mesas e mapa de treinamento, com texto acessível além da cor.
- Amarelo: aguardando garçom; azul: aguardando registro, preparo ou entrega do pedido; vermelho: aguardando fechamento da conta.
- Resumo lateral com quantidades por tipo, sino com total e central filtrável de notificações.
- Ações autenticadas para chamar garçom e confirmar atendimento. Chamada repetida não duplica contador; mesa livre ou em fechamento recusa novo chamado.
- Estados operacionais derivados do servidor, uma pendência por mesa e prioridade fechamento > garçom > pedido.
- Dados e contadores sincronizados via notificações Socket.IO e recuperação REST; nenhum serviço externo ou permissão de push é necessário.
- Migração 6 aditiva: `table_service_state`, vinculada à sessão de atendimento. Chamados e atendimentos permanecem após reinicialização. O reset do treinamento limpa somente seu estado correspondente.

## API

- `GET /api/notifications`: estado e contadores sem valores financeiros, para usuários autenticados.
- `POST /api/tables/:id/call-waiter`: `{requestId}`, admin/caixa/garçom.
- `POST /api/tables/:id/acknowledge-call`: `{requestId}`, admin/caixa/garçom.
- Rotas equivalentes em `/simulacao/api`, com a autenticação e o banco do treinamento.

As ações usam transações, auditoria, CSRF e identificador idempotente. Abrir pedido confirma atendimento na mesma transação do pedido; solicitar fechamento grava a data na transação da mesa. Eventos são emitidos após o commit.

## Verificação executada

- **82 testes Vitest passaram**, incluindo três cenários de notificações: ciclo completo, autorização/isolamento e reabertura de SQLite físico.
- **11 testes Playwright passaram**, incluindo sincronização entre administrador e garçom em contextos distintos, chamada pelo celular, recarga, três cores/contadores, prioridade do fechamento e tela de 320 px sem rolagem horizontal.
- Tipagem estrita, ESLint, formatação e build passaram.
- Capturas desktop e celular inspecionadas visualmente: `test-results/notification-colors-desktop.png` e `test-results/notification-mesas-mobile.png`.
- Backup operacional criado antes da migração. Os testes usam bancos temporários, preservando pedidos e pagamentos da instalação.

Notificações são visuais dentro da aplicação. Navegador fechado não mostra alertas do sistema operacional; as pendências continuam salvas para recuperação ao reabrir. Não foi realizado teste com aparelho físico pela rede Wi-Fi.
