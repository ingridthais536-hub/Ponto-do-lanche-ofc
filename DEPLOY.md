# Ponto do Lanche — versão online

Esta versão foi preparada para hospedagem com Node.js + PostgreSQL + Socket.IO. O banco não depende de arquivo local, então os pedidos, produtos, caixa, estoque, caderno e tarefas ficam no PostgreSQL.

## Opção recomendada para o primeiro deploy: Render

1. Crie um repositório no GitHub e envie todos os arquivos desta pasta.
2. No Render, crie um Blueprint a partir do repositório. O arquivo `render.yaml` já cria o serviço web e o PostgreSQL.
3. Quando o Render pedir os segredos `ADMIN_USER` e `ADMIN_PASSWORD`, informe os dados que serão usados no painel.
4. Aguarde o deploy e abra a URL `https://...onrender.com`.
5. Teste `https://...onrender.com/healthz` e confirme `{"ok":true,...}`.
6. Abra `https://...onrender.com/admin` para o painel.

O Render documenta Blueprints para criar serviços e bancos juntos e permite ligar `DATABASE_URL` diretamente ao PostgreSQL pelo `fromDatabase`. citeturn1search0turn1search3

## Importante sobre o plano gratuito

O plano gratuito do Render é adequado para teste. A documentação atual informa que bancos PostgreSQL gratuitos expiram após 30 dias. Para uso contínuo da loja, selecione um plano de banco que não tenha essa limitação. citeturn0search6

## APK

Depois que o site estiver online, copie a URL HTTPS para `siteUrl` em `MainActivity.kt` do projeto Android. O Android WebView pode carregar um site hospedado online e requer a permissão de Internet. citeturn0search4

## Segurança

- Não coloque `DATABASE_URL`, `JWT_SECRET` ou a senha do administrador no GitHub.
- O `render.yaml` gera o `JWT_SECRET` e solicita as credenciais do administrador no painel.
- O painel usa cookie HTTP-only e rota autenticada.
