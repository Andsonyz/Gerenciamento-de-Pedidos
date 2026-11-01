# Estoque, compras e simulação — verificação

Entrega de 01/11/2026. Plano em [evolution-plan.md](evolution-plan.md).

## Implementado

- Comando explícito `access:reset-demo`: quatro contas existentes e equivalentes de treinamento; hash scrypt, revogação de sessões e política normal preservada.
- Ingredientes, fornecedores, fichas técnicas versionadas e cópias das necessidades no pedido.
- Livro de movimentações, reservas transacionais, consumo no preparo, liberação e desperdício no cancelamento; exceção administrativa justificada.
- Compras com rascunho, confirmação, recebimentos parciais idempotentes, alocação exata de centavos e cancelamento do restante.
- Indicadores por período e fuso, ranking de produtos, pagamentos separados, consumo/perdas e reposição com limites explícitos.
- Treinamento com SQLite independente, cookies e CSRF próprios, namespace Socket.IO e armazenamento separados.
- Salão de 12 mesas, fila de clientes, atendimento interativo/automático, cozinha/caixa opcionais, cenários de simultaneidade/cancelamento/falha/falta de estoque.
- Relógio virtual, gerador reproduzível, estado persistido e retomada pausada após reinicialização; reset restrito ao treinamento.

## Arquitetura e migrações

Mantidos os três workspaces e o driver SQLite nativo. Nenhuma dependência nova foi necessária. Autenticação e auditoria usam horário real; pedidos, estoque, compras e pagamentos usam o relógio operacional do contexto.

- Versão 2 anterior preservada, com INSERT de configurações usando colunas explícitas para compatibilidade com migrações posteriores.
- Versão 3: fornecedores, ingredientes, receitas, snapshots dos itens, reservas, movimentações, compras e recebimentos.
- Versão 4: execução, grupos e eventos, somente no banco de treinamento.
- Versão 5: fuso de configurações, padrão `America/Fortaleza`.

As migrações são aditivas e não preenchem fichas técnicas ou saldos fictícios no restaurante real. FKs, índices, WAL, busy timeout e auditoria permanecem. As transações dos serviços participam da operação externa sem BEGIN aninhado.

## API adicional

As rotas existentes permanecem. Cada família tem equivalente sob `/simulacao/api`, com autenticação independente.

| Família                      | Operações                                                                   | Permissão                                                     |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `/ingredients`               | GET, POST, PATCH por ID, histórico de preços por ID                         | Consulta admin/caixa; alteração admin                         |
| `/products/:id/recipes`      | GET histórico, POST versão                                                  | Consulta admin/caixa; alteração admin                         |
| `/inventory`                 | GET saldo, GET movements paginado, POST adjustments                         | Consulta admin/caixa; alteração admin                         |
| `/suppliers`                 | GET, POST, PATCH por ID                                                     | Consulta admin/caixa; alteração admin                         |
| `/purchases`                 | GET paginado, GET por ID, POST, PATCH rascunho, POST confirm/receive/cancel | Consulta admin/caixa; alteração admin                         |
| `/analytics`                 | GET período, categoria, produto, ingrediente, fornecedor e cobertura        | Admin/caixa                                                   |
| `/simulation` no treinamento | GET estado, POST start/control, POST groups/:id/claim/serve                 | Controles admin; atendimento admin/garçom; estado autenticado |

Pedidos aceitam `overrideReason` opcional, validado como exceção de administrador. Catálogo expõe somente indicadores `stockTracked` e `stockAvailable` aos garçons, sem custos de ingredientes. Cozinha não recebe preços.

## Evidências executadas

- Estado inicial: **50 testes passaram** antes das mudanças.
- Estado final: **79 testes passaram** em 11 arquivos Vitest, incluindo HTTP, SQLite, Socket.IO e regras financeiras/operacionais.
- **10 testes Playwright passaram**: compras/recebimento/receita/indicadores; ciclo automático; atendimento interativo móvel; regressões de pedidos, caixa, cozinha, reconexão, abas, permissões e PWA.
- Tipagem estrita, ESLint, formatação e build passaram na execução final.
- Oito logins da instância local foram conferidos: quatro perfis no operacional e quatro no treinamento, incluindo recuperação da sessão e logout.
- O banco real preservou seus três pedidos anteriores. Integridade SQLite retornou `ok` e nenhuma violação de chave estrangeira nos dois bancos e no backup anterior.
- Backups consistentes de ambos os ambientes foram criados após a migração, usando os comandos documentados.

Os bancos de teste são temporários. Capturas em `test-results/evolution-inventory-analytics.png`, `evolution-simulation-automatic.png` e `evolution-simulation-waiter-mobile.png`. As telas de simulação desktop e móvel foram inspecionadas visualmente.

### Defeitos encontrados e corrigidos

- Reabertura após adicionar fuso falhava por INSERT sem lista de colunas. Teste de reinício agora cobre arquivo SQLite real.
- Ordem de preparo podia bloquear uma reserva anterior mesmo com déficit autorizado. A autorização registra as reservas afetadas do ingrediente.
- Outro nome, diferença de maiúsculas no Windows ou hard link podiam apontar os dois contextos para o mesmo banco. Validação física precede a abertura do treinamento; teste com hard link comprovou a falha e a correção.
- Filtro por fornecedor ignorava entregas pendentes de outros fornecedores na reposição. Cobertura passou a considerar todas as compras abertas.
- Arredondamento de previsão por ponto flutuante adicionava uma unidade indevida. O teto da demanda usa aritmética inteira.
- Painel diário dependia do relógio/fuso do processo. Agora usa fuso do restaurante e relógio virtual no treinamento.
- Redefinição de acessos passou a abranger explicitamente os dois bancos, sem redefinição automática no startup.

## Limitações

Não foram testados aparelho físico, roteador, Wi-Fi, regras reais de firewall ou instalação Android/iOS. Não há certificação WCAG nem ensaio de grande volume. Não há impressão física, emissão fiscal, integração bancária, contas a pagar, múltiplos depósitos ou gestão de lotes/validade. Estoque tem precisão de uma unidade base. Reposição é estimativa por consumo observado, com mínimo como alternativa em histórico curto. Consultas analíticas agregam o histórico local; listas de compras e movimentações têm paginação. Não foi realizado push ou publicação externa.
