# POC — CRM lateral dentro da DKdevs++

## O que foi adicionado

A extensão agora suporta uma nova feature:

- `deskSidebar`

Quando ela vier ativa na API de tenants, a extensão:

1. injeta uma barra lateral no próprio BLiP Desk;
2. abre a lateral ao clicar em um ticket;
3. consulta endpoints externos para protocolo, cliente, agendamento e anexos;
4. permite upload de arquivo se `uploadEndpoint` estiver configurado.

## Fluxo

```text
Popup/Content -> consulta tenant API
                -> settings.features.deskSidebar.enabled = true
                -> hook.js cria sidebar no Desk
                -> clique em ticket abre lateral
                -> hook.js pede fetch ao content.js
                -> content.js consulta API
                -> sidebar renderiza dados
```

## Exemplo de payload esperado da API de tenants

```json
{
  "active": true,
  "settings": {
    "features": {
      "deskSidebar": {
        "enabled": true,
        "title": "CRM lateral",
        "serviceName": "desk.crmSidebar",
        "apiBaseUrl": "https://api.exemplo.com",
        "protocolEndpoint": "/protocol",
        "customerEndpoint": "/customer",
        "scheduleEndpoint": "/schedule",
        "attachmentsEndpoint": "/attachments",
        "uploadEndpoint": "/attachments/upload",
        "validatorUrl": "https://sistema.exemplo.com/validator"
      }
    }
  }
}
```

## Query params enviados para os endpoints

A sidebar monta URLs com:

- `ticketId`
- `conversationId`
- `protocol`

## Arquivos alterados

- `manifest.json`
- `content.js`
- `popup.js`
- `hook.js`

## Observações

- Isto é uma POC.
- Os seletores de ticket podem precisar de ajuste conforme o Desk real.
- O ideal é restringir `host_permissions` depois para os domínios exatos da API.


## Captura de contato via socket

A sidebar agora também intercepta mensagens recebidas no `WebSocket` do Desk e, quando encontra envelopes `application/vnd.lime.contact+json`, normaliza os dados do contato e associa ao ticket aberto.

Campos aproveitados do socket:

- nome
- CPF (`taxDocument`)
- telefone
- e-mail
- cidade/UF/CEP
- endereço, bairro, complemento e ponto de referência
- protocolo (`extras.protocol`)
- dados auxiliares como `crmId`, `familyCode` e `team`


## Atualização 1.0.4
- Vinculação prioritária do contato por `identity`.
- Mantém atualização imediata da sidebar quando o contato chega pelo socket do ticket aberto.
- Faz fallback temporário por ticket até a `identity` ficar conhecida, evitando perder atualização em tempo real.
