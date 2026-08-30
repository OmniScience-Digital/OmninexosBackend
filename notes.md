get encrytion key for zero tokens using 
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"


To wire up crm shoughn files changed are ,xero.quotewebhook,contorller.ts 
this was commented , // handleQuoteStatuses(quote),

Then in xero.quote.service.ts  comment this      // await handleQuoteStatuses(quote);
use this for shoughn ,await syncQuoteToCrmShaughn(quote);


bullmq abnomalitioes ,
redis-cli KEYS "bull:quote-polling:*" | xargs redis-cli DEL


zip -r OmninexosBackendServer.zip . -x "node_modules/*" ".git/*" "dist/*" "*.DS_Store"


connect on local host
http://localhost:5001/api/v1/xero/connect


ngrok http 5001


First step when setting up xero

Update client id and client secret from configuration
Then update tenant id
Send intent to receive once its okay 
Then connect  ,http://localhost:5001/api/v1/xero/connect


//get business unit options

Replace `TASK_ID` with your ClickUp task ID:

```bash
curl -s "https://api.clickup.com/api/v2/task/TASK_ID" \
-H "Authorization: YOUR_CLICKUP_API_TOKEN" | jq '.custom_fields[] | select(.name == "Business Unit")'
```

Replace only:

* `TASK_ID` → your task ID
* `YOUR_CLICKUP_API_TOKEN` → your ClickUp API token


web hook 
https://katherin-agrostologic-stalkingly.ngrok-free.dev