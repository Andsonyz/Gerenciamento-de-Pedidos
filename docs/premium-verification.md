# Verificação da atualização premium

Execução em **29/10/2026**, Windows, Node.js **24.22.1**, npm **11.19.1**, Chromium do Playwright. A estrutura existente foi preservada e evoluída na branch `feat/restaurante-mvp`. As alterações permanecem no workspace, sem push ou publicação.

## Evidências executadas

| Verificação                         | Resultado                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                 | Contratos, backend e frontend passaram com TypeScript estrito                                          |
| `npm run lint`                      | ESLint passou                                                                                          |
| `npm run format:check`              | Formatação verificada com Prettier                                                                     |
| `npm test`                          | 50 testes: HTTP, SQLite, autenticação, autorização, finanças, Socket.IO, HTTPS e lógica de frontend    |
| `npm run test:e2e`                  | 7 testes passaram no Chromium, com build de produção                                                   |
| `npm run build`                     | Três workspaces compilados; executado também pelo E2E                                                  |
| `npm audit`                         | Nenhuma vulnerabilidade reportada pelas dependências instaladas                                        |
| `npm run demo:setup`                | Criou os quatro perfis com senhas aleatórias, sem credenciais padrão no código                         |
| `npm start`                         | Servidor compilado iniciado na porta 3001 e interfaces IPv4 locais                                     |
| Login no servidor real              | Admin, caixa, garçom e cozinha entraram pela interface; permissões da API verificadas para cada perfil |
| `npm run backup`                    | Backup consistente gerado pela API SQLite; arquivo aberto e integridade conferida                      |
| Integridade real do banco           | `integrity_check = ok`, sem violações em `foreign_key_check`                                           |
| Preservação da instalação existente | Os 3 pedidos legados continuam presentes como 3 pedidos migrados, com mesas e sessões preservadas      |
| Credenciais locais                  | `.local-access.json` confirmado como ignorado pelo Git; fora da pasta pública                          |

Os testes de integração/E2E usam bancos temporários. A validação dos logins reais consultou dados e exercitou autenticação/visualização, sem inserir pedidos ou pagamentos fictícios na instalação. Abrir o simulador confirma a exibição de comandas existentes, conforme o comportamento implementado.

## Cenários críticos

| Requisito                               | Evidência                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pedido aparece no desktop e cozinha     | E2E com três contextos autenticados separados e comunicação real Socket.IO                                                                       |
| Dois garçons simultâneos                | API: 20 envios concorrentes alternados entre dois usuários, IDs/números únicos e fila correspondente                                             |
| Envios duplicados                       | API: 10 tentativas da mesma chave; somente uma criação. E2E: clique rápido, resposta perdida e recuperação após reload                           |
| Duas abas independentes                 | E2E: respostas perdidas nas duas abas, diário preservado e recuperação de ambas sem repetir pedidos                                              |
| Solicitar/aprovar/rejeitar cancelamento | API e interface; rejeição preserva a conta, aprovação parcial reduz o saldo                                                                      |
| Cancelamento parcial                    | Mantém quantidade original, quantidade cancelada, motivo, autor e histórico; cria aviso para a cozinha                                           |
| Ciência do preparo                      | API bloqueia aprovação sem confirmação adicional quando o pedido está em preparo                                                                 |
| Conta consolidada e preço histórico     | Soma no backend; atualização posterior de nome/preço do produto não altera pedidos anteriores                                                    |
| Pagamento parcial/múltiplo e troco      | E2E registra R$ 20,00 em dinheiro com R$ 50,00 recebidos e troco de R$ 30,00; quita o restante por Pix                                           |
| Cancelamento após pagamento             | API bloqueia; estorno manual separado exige administrador, motivo e saldo disponível                                                             |
| Encerramento                            | Saldo pendente bloqueia caixa; baixa excepcional exige admin e auditoria; conta quitada libera a mesa                                            |
| Falha da impressora                     | Simulação interrompe atualização da central; trabalhos seguem salvos e são recuperados na reconexão                                              |
| Reinicialização                         | Teste encerra/recria o servidor e recupera pedidos, pagamentos, sessão, falhas e idempotência                                                    |
| Reconexão Socket.IO                     | Conexão autenticada, falha de transporte forçada e reconexão automática; recuperação REST mantém uma comanda por ID                              |
| Permissões                              | Garçom recebe 403 em usuários, auditoria, caixa, contas e fila; cozinha não consulta preços/pedidos financeiros                                  |
| Sessões revogadas                       | Alterar/desativar funcionário invalida sessão HTTP e desconecta socket                                                                           |
| Rascunho de atendimento encerrado       | Novo atendimento na mesma mesa rejeita envio com sessionId anterior                                                                              |
| Comandas canceladas                     | Cancelamento total invalida produção pendente, inclusive cópias de cópias; reimpressões de avisos permanecem disponíveis                         |
| Catálogo/equipe                         | E2E cadastra categoria, produto, disponibilidade e funcionário; consulta persistência e auditoria                                                |
| Uso sem serviços externos               | E2E monitora requisições; scripts, estilos, ícones e fontes permanecem locais                                                                    |
| PWA                                     | Manifest e ícones locais; service worker ativado no Chromium; cache estático não contém respostas da API                                         |
| HTTPS                                   | Teste usa certificado efêmero validado pelo cliente, sem alterar confiança do Windows; login responde com cookie Secure/HttpOnly/SameSite Strict |
| Responsividade e tema                   | E2E verifica viewport de 320 px sem transbordamento horizontal e alternância para tema claro                                                     |

## Defeitos encontrados e corrigidos

- API pública antiga: substituída por autenticação e verificação de permissões no backend.
- Rascunho antigo poderia entrar na sessão seguinte da mesa: sessionId passou a ser obrigatório, validado na transação e incorporado ao rascunho.
- Cancelamento total deixava reimpressão de produção pendente: a cadeia de cópias agora é invalidada; reimpressão de produção cancelada é bloqueada.
- Diário de uma aba poderia apagar outra: cada operação é persistida por UUID e concluída individualmente, com escopo por aba.
- Formulário de encerramento enviava motivo vazio incompatível com validação: motivo é incluído somente no fluxo excepcional.
- Campos de seleção recebiam nomes acessíveis incluindo opções: rótulos explícitos passaram a identificar os controles; o teste real de catálogo/equipe passou.
- Simulador continuava recebendo dados durante falha: a conexão e a atualização da central são pausadas e recuperadas por REST.
- Estados ocultos de comandas eram confirmados como exibidos: confirmação automática considera visibilidade da página e filtro apresentado.
- Ajustados limites de senha/observações, proteção de cliques imediatos, rascunho inválido e contraste dos temas.
- Uma sub-rede configurada amplamente não pode autorizar IP público; a restrição privada é aplicada antes do filtro personalizado.

Uma primeira execução de E2E detectou um problema no próprio cenário de duas abas: a interceptação continuava descartando a resposta da tentativa de recuperação. O teste agora remove a interceptação antes da recuperação e passou. Nenhum teste foi desabilitado para obter o resultado.

## Capturas produzidas

Em `test-results/`, ignorado pelo Git:

- `premium-dashboard.png`: painel com dados registrados pelos testes.
- `premium-conta-desktop.png`: conta quitada, pagamentos e encerramento.
- `premium-cozinha.png`: comandas de pedido e cancelamento.
- `premium-garcom-320.png`: tema claro no celular de 320 px.
- `runtime-admin.png`, `runtime-cashier.png`, `runtime-waiter.png`, `runtime-kitchen.png`: logins na instalação real, quando executada a verificação local.

As capturas desktop e celular foram inspecionadas visualmente. Imagens e traces são artefatos locais e podem ser regenerados pelos testes.

## Limites conhecidos e verificações externas

- Não houve teste em telefone físico, impressora física, roteador real ou regra de firewall. Validar a rede privada do restaurante antes do uso operacional.
- A PWA foi verificada no Chromium local; instalação em Android/iOS e confiança do certificado no aparelho dependem de configuração local. O projeto não instala autoridades de certificado automaticamente.
- Não há validação/certificação formal WCAG nem ensaio de carga além dos cenários descritos.
- Estorno de conta encerrada está bloqueado; o fluxo manual implementado atende contas abertas. Uma futura correção financeira após encerramento requer módulo próprio.
- Pagamentos são registros manuais, sem integração bancária; impressão é simulada. A conta de consumo é não fiscal. PDF dedicado e ESC/POS estão preparados na arquitetura, sem implementação de hardware.
- SQLite é adequado ao servidor local único deste MVP. Histórico/filas completos e processamento síncrono pedem paginação e avaliação de escala para volumes elevados.
- O npm/Playwright emitiu avisos de cores `NO_COLOR`/`FORCE_COLOR`; os comandos terminaram normalmente. Não se afirma ausência de todos os bugs a partir destes resultados.
