# Ponto do Lanche — Sistema completo online

Sistema de pedidos para celular/computador com área pública e painel privado da loja.

### Inclui
- Cardápio por categorias
- Carrinho e checkout
- Nome + WhatsApp
- Mesa/viagem
- Pagamento e troco
- Número do pedido
- Consulta do pedido pelo número
- Socket.IO para atualização em tempo real
- Painel protegido por login
- Pedidos e mudança de status
- Cardápio editável
- Fluxo de caixa
- Estoque
- Meu Caderno
- Tarefas
- Dashboard
- Configurações da loja
- PostgreSQL para dados persistentes
- Health check para hospedagem

### Estrutura
- `site/` — cliente
- `admin/` — painel da loja
- `server.js` — API + servidor + Socket.IO
- `render.yaml` — infraestrutura Render
- `DEPLOY.md` — implantação

### Desenvolvimento local

```bash
npm install
cp .env.example .env
npm start
```

O PostgreSQL precisa estar disponível e `DATABASE_URL` configurada.
