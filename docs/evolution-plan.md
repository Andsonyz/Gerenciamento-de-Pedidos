# Evolução — estoque, compras e simulação

Plano aprovado em 01/11/2026. Preservar workspaces, fluxos premium e dados existentes.

1. Diagnóstico: 50 testes passaram; backup consistente criado antes de alterações.
2. Acessos: comando local redefine somente quatro contas para 123, revoga sessões e preserva política geral.
3. Ingredientes/receitas: versões e quantidades inteiras; sem dados inventados no banco operacional.
4. Estoque: reserva na confirmação, consumo no preparo, liberação ou desperdício nos cancelamentos.
5. Compras: fornecedores, recebimento parcial idempotente e histórico.
6. Indicadores: fontes e datas explícitas, reposição com cobertura e limitações.
7. Simulação: banco, autenticação, transporte e armazenamento separados, com regras compartilhadas.
8. Salão: atendimento interativo/automático, relógio persistido e recuperação pausada.
9. Verificação: testes de domínio, integração, interface, tipagem, lint e build.
10. Documentação: instruções Windows, acessos, resultados e limitações.

## Decisões de integração

- O SQLite da simulação é fixado pelo servidor; o cliente não escolhe arquivos.
- Serviços compartilham a transação do chamador através de `withinTransaction`; não há BEGIN aninhado.
- Datas operacionais podem usar relógio simulado; autenticação e auditoria usam horário real.
- Exceção de estoque exige administrador e justificativa. Estoque negativo autorizado continua visível.
- Nenhuma publicação ou alteração de firewall faz parte desta entrega.

## Progresso

- Diagnóstico e backup: concluídos.
- Implementação e validação: concluídas; evidências e limitações em [evolution-verification.md](evolution-verification.md).
