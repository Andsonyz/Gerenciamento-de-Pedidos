# mesa. — Gestão de Restaurante

Sistema local com três ambientes integrados: **administração e caixa**, **garçom** e **Central de Impressão — Cozinha**. Os dados ficam em um único SQLite no computador servidor. A interface possui temas escuro e claro, layout para desktop e navegação para celulares.

Pedidos, cancelamentos, pagamentos manuais e comandas são funcionais e persistidos. O sistema gera conferências de consumo não fiscais. A cozinha usa um simulador visual de comandas de 80 mm, sem preços e sem integração com equipamentos físicos.

## Instalação no Windows e VS Code

Requisitos: **Node.js 24.x**, npm e VS Code. Ambiente verificado: Node **24.22.1**, npm **11.19.1**, Windows e Chromium. O driver SQLite está incluído no Node; não precisa instalar banco separado nem Docker.

1. Abra esta pasta no VS Code, em **Arquivo → Abrir Pasta**.
2. Abra **Terminal → Novo Terminal** na raiz do projeto.
3. Execute:

```powershell
node --version
npm --version
npm ci
```

Se o PowerShell bloquear `npm.ps1`, use `npm.cmd` e `npx.cmd`, ou o terminal Prompt de Comando. A instalação das dependências e do navegador de testes requer internet. Após a instalação e o build, a operação é local; fontes, ícones e scripts não usam CDN.

## Primeiro acesso e usuários

Para uma instalação nova, crie seu administrador:

```powershell
npm run setup
```

O terminal pede identificação, nome e senha com pelo menos **12 caracteres**. A senha não aparece enquanto é digitada. Depois do login, use **Equipe** para cadastrar caixas, garçons e cozinha, redefinir senhas ou desativar acessos. Não existe senha padrão automática.

Para experimentar todos os perfis com acessos gerados localmente:

```powershell
npm run demo:setup
```

Esse comando cria, explicitamente, os usuários `admin`, `caixa`, `garcom` e `cozinha`, com **senhas aleatórias diferentes**, e informa as senhas no terminal. Os acessos desta instalação ficam em **`.local-access.json`**, na raiz, ignorado pelo Git e fora da pasta pública. Contas já existentes são preservadas. O comando se recusa a sobrescrever um arquivo de acessos existente.

Consulte o arquivo local pelo VS Code. Altere as senhas e desative os acessos de teste em **Equipe** antes de operar com dados reais. Os usuários de testes automatizados pertencem a bancos temporários e não são os acessos desta instalação.

| Perfil        | Acesso                                                                               |
| ------------- | ------------------------------------------------------------------------------------ |
| Administrador | Painel, mesas, pedidos, caixa, cozinha, catálogo, equipe, auditoria e configurações  |
| Caixa         | Painel, mesas, pedidos, contas, pagamentos e análise de cancelamentos                |
| Garçom        | Mesas, cardápio, rascunhos, envio, próprios pedidos e solicitações de cancelamento   |
| Cozinha       | Comandas operacionais, etapas de preparo, recuperação da fila e reimpressão simulada |

## Executar a versão compilada

Na raiz:

```powershell
npm run build
npm start
```

Um único servidor entrega frontend, API e Socket.IO na porta **3001**:

- Acesso e login: **http://localhost:3001**
- Administração: **http://localhost:3001/painel**
- Mesas/garçom: **http://localhost:3001/mesas**
- Cozinha: **http://localhost:3001/cozinha**

As rotas exigem login e o perfil apropriado. Mantenha o computador ligado e sem suspensão durante o atendimento. Use `Ctrl+C` para encerrar. Depois de modificar o código, execute o build novamente.

## Desenvolvimento

Um comando inicia os dois serviços:

```powershell
npm run dev
```

Frontend: **http://localhost:5173**. Backend: **http://localhost:3001/api/health**.

Ou use dois terminais na raiz:

```powershell
# Terminal 1
npm run dev:backend
```

```powershell
# Terminal 2
npm run dev:frontend
```

O Vite encaminha `/api` e `/socket.io` para `127.0.0.1:3001`; o celular usa o mesmo endereço da página. A configuração de desenvolvimento usa HTTP e a porta de backend 3001. Para HTTPS/PWA, utilize a versão compilada com o servidor único descrito abaixo. Após alterar `shared/src`, reinicie `npm run dev` para recompilar os contratos.

## Acessar pelo celular no Wi-Fi

1. Conecte computador e celular à mesma rede privada.
2. Execute `ipconfig` no Windows. No adaptador **Wi-Fi** ou **Ethernet** conectado ao restaurante, procure **Endereço IPv4**, por exemplo `192.168.1.20`. Ignore VPN, WSL, adaptadores virtuais e `127.0.0.1`.
3. No navegador do celular, abra **http://192.168.1.20:3001**, substituindo o IP pelo encontrado. Em desenvolvimento, use **http://192.168.1.20:5173**.
4. Entre com o usuário de garçom. `localhost` no celular aponta para o próprio aparelho.

Alternativa para listar os endereços:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Select-Object IPAddress, InterfaceAlias
```

Frontend e backend escutam em `0.0.0.0`. O backend restringe conexões a loopback e IPv4 privados; configure **`ALLOWED_SUBNETS`** para limitar ao segmento específico do restaurante. Sem configuração, são aceitas redes `10.0.0.0/8`, `172.16.0.0/12` e `192.168.0.0/16`. Nomes personalizados e IPv6 precisam de configuração de origens e sub-redes.

No Firewall do Windows, permita Node.js ou crie uma regra de entrada **apenas no perfil Privado**, na porta TCP 3001, com escopo **Sub-rede local**. Em desenvolvimento, permita também a porta 5173. O projeto não altera o firewall. Não faça redirecionamento de portas no roteador. Confira se a rede de convidados ou o isolamento de clientes do Wi-Fi impede a comunicação.

## HTTPS e instalação como PWA

A aplicação web funciona pelo IP em HTTP em rede confiável. Para proteger senhas no transporte e instalar a PWA no celular, use **HTTPS com certificado confiável no aparelho**. Service workers e instalação exigem contexto seguro; `localhost` é uma exceção somente no próprio dispositivo. [Referência MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

O servidor aceita `TLS_CERT` e `TLS_KEY`. Uma opção para certificados locais é o [mkcert](https://github.com/FiloSottile/mkcert), instalado pelo responsável pela rede:

```powershell
mkcert -install
mkcert -cert-file C:\Certificados\restaurante.pem -key-file C:\Certificados\restaurante-key.pem localhost 127.0.0.1 192.168.1.20
```

Crie antes a pasta de destino. Substitua o IP pelo do servidor. Instale e confie **somente o certificado público da autoridade local** nos celulares autorizados, conforme as instruções do mkcert e do sistema do aparelho. Nunca compartilhe `rootCA-key.pem` ou a chave privada do servidor. Essas etapas de confiança não são executadas automaticamente pelo projeto.

Configure `.env`, reinicie `npm start` e acesse `https://192.168.1.20:3001`. No navegador compatível, utilize **Instalar aplicativo / Adicionar à tela inicial**. Se o IP mudar, atualize o certificado e os endereços configurados.

O manifest, ícones e service worker estão incluídos. O cache guarda recursos estáticos; respostas da API e dados administrativos não são armazenados no cache. Rascunhos ficam no navegador por usuário, aba e atendimento. Um pedido só é confirmado quando persistido no servidor; não há um banco independente no celular nem envio financeiro offline.

## Configuração

Copie `.env.example` para `.env` na raiz se precisar alterar os padrões. O backend lê esse arquivo; variáveis já definidas no terminal têm prioridade. Caminhos absolutos são preferíveis.

```text
PORT=3001
DATABASE_PATH=C:\DadosRestaurante\restaurant.sqlite
ALLOWED_SUBNETS=192.168.1.0/24
ALLOWED_ORIGINS=http://localhost:3001,http://192.168.1.20:3001
```

Para HTTPS, inclua as origens `https://...` usadas e:

```text
TLS_CERT=C:\Certificados\restaurante.pem
TLS_KEY=C:\Certificados\restaurante-key.pem
```

Sem `ALLOWED_ORIGINS`, CORS e Socket.IO aceitam HTTP/HTTPS de localhost e IPs privados. Quando definida, a lista passa a ser exata, incluindo protocolo e porta; inclua a porta 5173 se usar desenvolvimento. Clientes de terminal sem `Origin` continuam sujeitos à autenticação e à restrição de rede. CORS não substitui autorização ou firewall.

## Operação

**Salão e pedidos:** abra o atendimento de uma mesa, escolha **Adicionar pedido**, ajuste quantidades, informe observações e revise antes de confirmar. O pedido preserva os preços vigentes na confirmação. Itens podem ser removidos livremente do rascunho. A chave original de uma operação incerta é mantida nas tentativas seguintes, inclusive após recarregar; use o aviso **operação aguarda confirmação** para recuperar.

**Cancelamentos:** o garçom informa itens, quantidades e motivo em seus pedidos. Caixa/administrador analisa e aprova ou rejeita; também pode cancelar diretamente com justificativa. Em preparo ou pronto, é exigida ciência adicional. O histórico mantém quantidade original e cancelada, autor e estados. A cozinha recebe um novo aviso. Cancelamento total invalida também cópias de produção ainda pendentes; avisos de cancelamento continuam disponíveis.

**Caixa:** em **Mesas → Ver conta e receber**, confira itens, preços unitários, totais, descontos, serviço, pagamentos e saldo. O administrador pode ajustar desconto/serviço com motivo, antes de haver pagamentos líquidos. Registre dinheiro, Pix, débito ou crédito manualmente; a opção Outros depende de Configurações. Pagamentos parciais e múltiplos são permitidos; dinheiro calcula troco. O backend recalcula o saldo e impede pagamento acima do devido.

**Estorno e encerramento:** pagamentos líquidos bloqueiam cancelamento normal. O administrador pode registrar um estorno manual separado com valor e justificativa em uma conta ainda aberta. Isso registra a devolução já feita por outro meio. Só encerre normalmente com saldo zero. A baixa excepcional exige administrador, justificativa e auditoria. Contas encerradas são preservadas e não aceitam novos pedidos, alterações ou estornos nesta versão.

**Conta de consumo:** use **Imprimir conferência não fiscal** para abrir a impressão do navegador. A conta inclui consumo, valores, ajustes, pagamentos e saldo. O navegador pode salvar em PDF; geração dedicada de PDF e emissão fiscal são evoluções futuras.

**Cozinha:** a central consulta os trabalhos salvos e recebe atualizações em tempo real. A comanda é marcada como exibida quando apresentada no simulador visível. Use **Simular desconexão**, envie pedidos e depois **Reconectar e recuperar fila**. Fechar a página não apaga trabalhos. **Reimprimir** cria uma cópia identificada com motivo, preservando a indicação de cancelamento. A cozinha também registra as etapas recebido → em preparo → pronto → entregue. Exibição no simulador não significa impressão física.

## Banco, migração e backup

Banco padrão: **`backend/data/restaurant.sqlite`**, independentemente de iniciar pelo workspace ou pela raiz. A primeira execução cria catálogo e 12 mesas; usuários só são criados pelos comandos explícitos de configuração.

A migração premium importa os pedidos da versão anterior, com IDs, números, preços e visualizações, preserva as tabelas originais e registra a versão em `schema_migrations`. Antes da primeira migração de arquivo existente, faz checkpoint e cria **`.pre-premium.bak`**. Encerre versões antigas do servidor antes de atualizar.

O esquema normalizado tem usuários, papéis, sessões de autenticação, mesas, atendimentos, categorias, produtos, pedidos/itens, solicitações/cancelamentos, pagamentos/estornos, trabalhos de impressão, auditoria, configurações e operações idempotentes. Usa chaves estrangeiras, índices, uma sessão ativa por mesa, WAL, timeout de 5 segundos e transações imediatas. Valores são centavos inteiros; limites são validados no backend.

Backup consistente, após compilar:

```powershell
npm run backup
# Ou escolha um arquivo novo:
npm run backup -- C:\BackupsRestaurante\fechamento.sqlite
```

O comando usa a API de backup do SQLite e permite copiar um banco em uso sem ignorar o WAL. O padrão é `backend/backups/`. Não sobrescreve arquivo existente. Faça backup diário, antes de atualizar e guarde uma cópia em mídia separada. Teste a restauração periodicamente. Para restaurar, encerre o servidor e aponte `DATABASE_PATH` para uma cópia íntegra do backup; preserve o banco atual para investigação. Não apague arquivos `-wal`/`-shm` de um banco aberto.

SQLite serializa gravações. Execute **uma instância do backend por banco**, em disco local; não coloque o arquivo em pasta de rede/OneDrive. A versão foi testada com 20 pedidos concorrentes; isso não equivale a certificação de carga para qualquer restaurante. Histórico e filas completos são consultados nesta versão; grande volume futuro pede paginação e avaliação de um banco servidor.

## Arquitetura

```text
backend/src/
  app.ts, routes.ts       HTTP, middleware e endpoints autorizados
  modules/               Autenticação, restaurante, cancelamentos e finanças
  database/              Migração versionada, transações, importação e auditoria
  printing/              PrinterAdapter, PrintQueueAdapter e VirtualPrinterAdapter
  setup.ts               Administrador inicial, sem senha padrão
  demo-setup.ts           Acessos de teste gerados explicitamente
  backup.ts              Backup consistente
frontend/src/
  App.tsx                Login, navegação e layouts por perfil
  Admin.tsx              Indicadores, catálogo, equipe, auditoria e configurações
  Tables.tsx             Mesas, contas, pagamentos e histórico
  Orders.tsx             Composição, próprios pedidos e cancelamentos
  Kitchen.tsx            Comandas e recuperação da central
  state.tsx              Estado autorizado, sessões e sincronização
  operations.ts          Diário local de tentativas incertas, isoladas por aba
shared/src/              Contratos TypeScript compartilhados
backend/tests/           Integração HTTP, SQLite e Socket.IO
frontend/tests/          Valores, identificação e recuperação
e2e/                     Fluxos reais no Chromium
```

A estrutura original dos três workspaces foi mantida para evitar movimentações desnecessárias. `database.ts` também mantém o leitor legado usado pela migração. Detalhes e contrato da API: [arquitetura premium](docs/premium-architecture.md).

Os serviços de pedidos dependem do contrato da fila de impressão. Um futuro `EscPosPrinterAdapter` deverá implementar entrega/retentativa e confirmação física sem alterar o registro do pedido. Exigirá spool persistente, política para resultado de impressão incerto e testes com equipamento; não basta tratar Socket.IO como confirmação física.

## Segurança

Senhas usam scrypt com salt; o banco guarda hashes. Sessões têm token aleatório em cookie HttpOnly/SameSite Strict e expiram em 12 horas; o banco guarda hash do token. Mutações exigem CSRF. Alterar/desativar usuário revoga suas sessões. O backend valida dados com Zod, usa parâmetros SQL, limita tamanho de corpo e tentativas de login, aplica papéis e protege conexões Socket.IO. React renderiza textos sem inserir HTML fornecido pelo usuário. Arquivos SQLite, chaves e credenciais não são servidos pelo frontend.

Use contas individuais e proteja também a conta Windows, os backups e o acesso físico ao servidor. A trilha é operacional; quem controla diretamente o arquivo SQLite pode alterá-lo. HTTPS confiável é recomendado para credenciais no Wi-Fi.

## Testes e verificações

```powershell
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
# Instalação inicial do navegador de teste:
npx playwright install chromium
npm run test:e2e
npm audit
```

Os testes usam bancos temporários e não alteram os pedidos desta instalação. O E2E exige a porta **3101** livre. Capturas e traces ficam em `test-results/` e não são versionados. O relatório [verificação premium](docs/premium-verification.md) distingue o que foi executado das limitações conhecidas. [Verificação do MVP anterior](docs/verification.md) permanece como registro histórico.

## Solução de problemas

| Problema               | Verificação                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Não consigo entrar     | Confira os acessos locais ou execute `npm run setup` em instalação vazia; um admin pode redefinir senha em Equipe |
| Porta ocupada          | Encerre outra instância; não execute `npm start` e `npm run dev` juntos na mesma porta                            |
| Celular não abre       | Mesmo Wi-Fi, IP correto, servidor ativo, firewall Privado e ausência de isolamento no roteador                    |
| Erro de origem         | Confira protocolo/IP/porta na lista `ALLOWED_ORIGINS` e reinicie o backend                                        |
| Acesso de rede negado  | Confira `ALLOWED_SUBNETS`, interface escolhida e uso de IPv4                                                      |
| PWA não instala        | HTTPS com certificado confiável e nome/IP correspondente; verificar suporte do navegador                          |
| Conexão em recuperação | Atualize os dados; operações incertas devem ser retomadas pelo aviso, sem recriar o lançamento                    |
| Produto indisponível   | Revise o catálogo e o rascunho; a disponibilidade é conferida novamente no servidor                               |
| Cancelamento bloqueado | Resolva pedidos pendentes, confira quantidades, estado de preparo e pagamentos líquidos                           |
| Mesa não encerra       | Confira saldo e solicitações pendentes; baixa excepcional só com administrador e justificativa                    |
| Banco bloqueado        | Pare instâncias duplicadas, use disco local e tente novamente preservando o identificador da operação             |

## Limites desta entrega

Pagamentos e estornos são registros manuais; não há integração bancária, emissão fiscal ou hardware ESC/POS. Estornos de contas já encerradas exigem evolução futura específica; o fluxo atual bloqueia essa alteração. Não há transferência/divisão de mesas ou reservas por horário. A validação automatizada em viewport de celular não substitui teste do Wi-Fi, firewall, confiança HTTPS e instalação em aparelhos físicos do restaurante. WCAG recebeu cuidados de foco, diálogo, rótulos e teclado, mas não há certificação formal de acessibilidade.
