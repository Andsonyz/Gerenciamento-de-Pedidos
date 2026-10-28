# MVP de pedidos em LAN

Escopo: implementar o pedido detalhado do usuário neste repositório. React/Vite/Tailwind para garçom e impressora; Express/Socket.IO/SQLite para persistência e distribuição. Sem serviços externos em execução, autenticação, finanças avançadas ou hardware de impressão.

Decisões de implementação: npm workspaces (shared, backend, frontend), Node 24 com node:sqlite, 12 mesas e produtos de exemplo. O servidor entrega o frontend compilado; Vite encaminha API e sockets no desenvolvimento. Ambos escutam 0.0.0.0. CORS permite origens locais por padrão e lista explícita opcional.

Alternativas consideradas: SQLite com módulo nativo externo exigiria ferramentas adicionais no Windows; node:sqlite reduz instalação. Eventos isolados não garantem recuperação; banco persistente mais sincronização completa em cada conexão garante recuperação. Escolhas técnicas feitas pelo implementador dentro do escopo solicitado.

Pedido recebe UUID e número sequencial. Transação persiste pedido e itens com nomes e preços copiados. requestId único torna reenvio idempotente; mesma chave com conteúdo diferente retorna conflito. Cliente mantém envio incerto em localStorage para repetir exatamente o mesmo pedido após falha/recarregamento. Confirmação visual só após resposta persistida.

PrinterAdapter separa serviço e transporte; VirtualPrinterAdapter publica eventos e sincroniza histórico persistido. Visualizada é estado global e explícito, persistido; receber comanda não a marca automaticamente. Reconexão recebe snapshot e a UI substitui/atualiza por ID, nunca concatena cegamente. Simulação desliga socket e ações da impressora até reconectar.

Validação: limites de quantidade/observações, mesas e produtos existentes, JSON inválido, corpo limitado. Valores em centavos. Persistência permanece em backend/data por padrão, independente do diretório de execução. Uma instância backend por arquivo.

Verificação: integração HTTP/SQLite/Socket.IO reais, reinício, simultaneidade, idempotência e recuperação; navegador real para fluxo celular, impressora, histórico e reconexão. Testes usam bancos temporários.
