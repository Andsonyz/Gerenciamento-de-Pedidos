# Verificação do MVP

Executada em **27/10/2026**, Windows, Node.js **24.22.1**, npm **11.19.1**, Chromium do Playwright. Arquivos entregues na branch `feat/restaurante-mvp`, sem commit, push ou publicação automática.

## Comandos executados

| Comando | Resultado observado |
| --- | --- |
| `npm ci` | Instalação pelo lockfile concluída |
| `npm test` | **21 testes passaram**, 2 arquivos |
| `npm run typecheck` | Frontend e backend sem erros de TypeScript |
| `npm run build` | Shared, backend e frontend compilados |
| `npm run test:e2e` | **5 testes passaram** em Chromium, após o build final |
| `npm audit` | **0 vulnerabilidades** |
| `npm run dev` | Frontend 5173 e backend 3001 iniciados em `0.0.0.0` |
| `npm start` | Versão compilada iniciou e serviu páginas/API/socket na porta 3001 |

O ambiente npm emitiu aviso sobre política de install-scripts do esbuild; instalação, compilação e execução funcionaram. Playwright emitiu aviso de conflito `NO_COLOR`/`FORCE_COLOR`, sem falha nos testes.

## Evidência por requisito

| Requisito | Verificação |
| --- | --- |
| Mesas, produtos e pedido no celular | E2E em viewport 390×844: selecionou mesa, adicionou produto, aumentou quantidade, removeu outro, preencheu observação e confirmou |
| Feedback e prevenção de duplicidade | E2E de clique repetido durante envio; resposta HTTP perdida após persistência; recarregamento e reenvio da mesma chave; consulta confirmou um único pedido |
| Duas abas independentes | Regressão reproduziu perda de chave entre abas; após correção, A recupera seu envio incerto mesmo depois de B confirmar outro |
| Validação no servidor | 11 casos inválidos, JSON malformado e conflito entre chave/conteúdo; entradas rejeitadas não geram pedido |
| Identificadores, produtos e recuperação | Integração HTTP/SQLite verificou UUID, número, horário, dados do catálogo, consulta e reabertura do mesmo arquivo de banco |
| Pedidos simultâneos | 20 requisições independentes preservadas com números únicos; 10 reenvios da mesma chave produzem apenas uma criação |
| Impressora em tempo real | HTTP e Socket.IO reais entregaram novas comandas e atualizações de visualização |
| Falha e reconexão | Integração forçou fechamento do transporte e observou reconexão automática; E2E simulou falha, enviou pedido durante pausa e reconectou repetidamente sem duplicação |
| Impressora fechada | E2E fechou a página, enviou pedido e reabriu: comanda recuperada do banco |
| Histórico e estados | E2E marcou como visualizada, recarregou e consultou filtro; integração confirmou estado após reinício do backend |
| Comanda de 80 mm | `Receipt.tsx` e CSS com `width: 80mm`; inspeção das capturas mostrou número, mesa, data/hora, produtos, quantidades, observações e estados |
| Responsividade | E2E verificou ausência de transbordamento horizontal nas duas telas em 320 px; capturas desktop e mobile foram inspecionadas |
| Sem dependência de serviços externos | E2E das telas registrou requisições e confirmou somente recursos locais; nenhuma exceção JavaScript nas páginas verificadas |
| LAN e CORS | Integração permite origem privada e rejeita origem externa; inspeção de sockets do Windows confirmou bind `0.0.0.0` nas duas portas |
| Acesso HTTP via IP | Chromium no próprio computador abriu `10.194.218.72:5173`, confirmou contexto HTTP não seguro, enviou pedido e recebeu comanda pelo proxy Vite. Repetido em `10.194.218.72:3001` com `npm start` |
| Arquitetura extensível | Revisão de código confirmou `OrderService` dependente de `PrinterAdapter`; Socket.IO isolado em `VirtualPrinterAdapter`, sem comandos para hardware |
| Entrega/documentação | README contém Windows/VS Code, comandos conjuntos e separados, build/start, descoberta de IPv4, firewall, uso, configuração, persistência, endpoints e testes |

## Correções verificadas

- Teste inicial de criação falhou com HTTP 404 antes da implementação da API; passou após implementação.
- Teste inicial de navegador falhou por ausência da interface da impressora; passou após implementação.
- A revisão independente reproduziu perda de chave entre duas abas do garçom. O teste de regressão falhou com observações vazias após reload e passou após usar armazenamento separado por `requestId`. Revisor confirmou a correção.
- A versão inicial de Vitest trouxe avisos de segurança; atualização para a versão corrigida e nova auditoria resultaram em zero vulnerabilidades.
- Um script avulso de verificação sofreu conversão de acentos pelo pipe do PowerShell. Reexecutado com UTF-8 e seletor estável, o teste de LAN passou; não era falha da aplicação.

## Limites do que foi testado

- Não houve teste em celular físico nem tráfego entre dois equipamentos. O acesso pelo IPv4 foi exercitado **no próprio computador**; isso não valida firewall/roteador entre dispositivos.
- Não foram alteradas configurações de firewall, Wi-Fi ou roteador.
- Não há alegação de testes em Safari/Firefox, carga prolongada, queda de energia, disco cheio ou desempenho com histórico muito grande. O MVP envia o histórico completo a cada conexão.
- Não há impressão física nesta versão. A largura física de 80 mm em monitores depende de escala/DPI; em telas estreitas a comanda se ajusta à largura disponível.
- Os testes automatizados e os testes avulsos de inicialização usaram bancos separados do banco padrão. Os servidores de verificação foram encerrados após a execução.

Capturas dos testes de navegador são geradas em `test-results` (ignorado pelo Git), incluindo `garcom-desktop.png`, `garcom-mobile.png`, `impressora-desktop.png` e `impressora-mobile.png`.
