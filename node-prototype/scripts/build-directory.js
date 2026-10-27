// Builds data/directory.json: the "Tier 2" library. Entries are unverified starting
// points (name, category, developer docs, typical auth); deep guides live in data/curated.
import fs from "node:fs";

const rows = `
Slack|Communication|https://docs.slack.dev|OAuth 2.0
Google Drive|Storage|https://developers.google.com/workspace/drive|OAuth 2.0, service account
Shopify|Commerce|https://shopify.dev|OAuth 2.0, client credentials
MongoDB Atlas|Database|https://www.mongodb.com/docs/atlas/api/|Service account (client credentials), database user
Gmail|Communication|https://developers.google.com/workspace/gmail|OAuth 2.0
Google Calendar|Productivity|https://developers.google.com/workspace/calendar|OAuth 2.0
Google Sheets|Productivity|https://developers.google.com/workspace/sheets|OAuth 2.0, service account
Google Docs|Productivity|https://developers.google.com/workspace/docs|OAuth 2.0
Microsoft Outlook (Graph)|Communication|https://learn.microsoft.com/graph|OAuth 2.0 (Microsoft identity platform)
Microsoft Teams (Graph)|Communication|https://learn.microsoft.com/graph|OAuth 2.0 (Microsoft identity platform)
OneDrive (Graph)|Storage|https://learn.microsoft.com/graph|OAuth 2.0 (Microsoft identity platform)
SharePoint (Graph)|Storage|https://learn.microsoft.com/graph|OAuth 2.0 (Microsoft identity platform)
Microsoft Excel (Graph)|Productivity|https://learn.microsoft.com/graph|OAuth 2.0 (Microsoft identity platform)
Dropbox|Storage|https://www.dropbox.com/developers|OAuth 2.0
Box|Storage|https://developer.box.com|OAuth 2.0, JWT, client credentials
Notion|Productivity|https://developers.notion.com|OAuth 2.0, internal integration token
Airtable|Productivity|https://airtable.com/developers/web|OAuth 2.0, personal access token
Asana|Project management|https://developers.asana.com|OAuth 2.0, personal access token
Trello|Project management|https://developer.atlassian.com/cloud/trello|API key + token
Jira|Project management|https://developer.atlassian.com/cloud/jira/platform|OAuth 2.0 (3LO), API token
Confluence|Productivity|https://developer.atlassian.com/cloud/confluence|OAuth 2.0 (3LO), API token
Linear|Project management|https://linear.app/developers|OAuth 2.0, API key
monday.com|Project management|https://developer.monday.com|OAuth 2.0, API token
ClickUp|Project management|https://developer.clickup.com|OAuth 2.0, personal token
Smartsheet|Project management|https://developers.smartsheet.com|OAuth 2.0, API token
Basecamp|Project management|https://github.com/basecamp/bc3-api|OAuth 2.0
Todoist|Productivity|https://developer.todoist.com|OAuth 2.0, API token
Evernote|Productivity|https://dev.evernote.com|OAuth 1.0a
Coda|Productivity|https://coda.io/developers|API token
GitHub|Developer tools|https://docs.github.com/rest|GitHub App, OAuth 2.0, personal access token
GitLab|Developer tools|https://docs.gitlab.com/api/|OAuth 2.0, access token
Bitbucket|Developer tools|https://developer.atlassian.com/cloud/bitbucket|OAuth 2.0, access token
Vercel|Developer tools|https://vercel.com/docs/rest-api|Access token, OAuth (integrations)
Netlify|Developer tools|https://docs.netlify.com/api/get-started/|OAuth 2.0, personal access token
Sentry|Developer tools|https://docs.sentry.io/api/|Auth token, OAuth (integrations)
PagerDuty|Developer tools|https://developer.pagerduty.com|OAuth 2.0, API key
Datadog|Developer tools|https://docs.datadoghq.com/api/|API key + application key
Postman|Developer tools|https://learning.postman.com/docs/developer/postman-api/intro-api/|API key
Salesforce|CRM|https://developer.salesforce.com|OAuth 2.0 (several flows)
HubSpot|CRM|https://developers.hubspot.com|OAuth 2.0, private app token
Pipedrive|CRM|https://developers.pipedrive.com|OAuth 2.0, API token
Zoho CRM|CRM|https://www.zoho.com/crm/developer/docs/api/|OAuth 2.0
Microsoft Dynamics 365|CRM|https://learn.microsoft.com/dynamics365/|OAuth 2.0 (Microsoft identity platform)
Close|CRM|https://developer.close.com|OAuth 2.0, API key
Copper|CRM|https://developer.copper.com|API key
Attio|CRM|https://docs.attio.com|OAuth 2.0, API key
Intercom|Support|https://developers.intercom.com|OAuth 2.0, access token
Zendesk|Support|https://developer.zendesk.com|OAuth 2.0, API token
Freshdesk|Support|https://developers.freshdesk.com|API key
Help Scout|Support|https://developer.helpscout.com|OAuth 2.0
Front|Support|https://dev.frontapp.com|OAuth 2.0, API token
ServiceNow|Support|https://developer.servicenow.com|OAuth 2.0, basic auth
Stripe|Payments|https://docs.stripe.com/api|API key, Stripe Connect OAuth
PayPal|Payments|https://developer.paypal.com|OAuth 2.0 (client credentials)
Square|Payments|https://developer.squareup.com|OAuth 2.0, access token
Braintree|Payments|https://developer.paypal.com/braintree/docs|API keys
Adyen|Payments|https://docs.adyen.com|API key
Plaid|Finance|https://plaid.com/docs|Client ID + secret, Link tokens
QuickBooks Online|Finance|https://developer.intuit.com|OAuth 2.0
Xero|Finance|https://developer.xero.com|OAuth 2.0
FreshBooks|Finance|https://www.freshbooks.com/api|OAuth 2.0
NetSuite|Finance|https://docs.oracle.com/en/cloud/saas/netsuite/|OAuth 2.0, token-based auth
Brex|Finance|https://developer.brex.com|OAuth 2.0, API token
Ramp|Finance|https://docs.ramp.com|OAuth 2.0
WooCommerce|Commerce|https://woocommerce.github.io/woocommerce-rest-api-docs/|API key (consumer key/secret)
BigCommerce|Commerce|https://developer.bigcommerce.com|OAuth 2.0, API account token
Magento (Adobe Commerce)|Commerce|https://developer.adobe.com/commerce/webapi/|OAuth 1.0a, tokens
Amazon Selling Partner API|Commerce|https://developer-docs.amazon.com/sp-api|OAuth 2.0 (Login with Amazon)
eBay|Commerce|https://developer.ebay.com|OAuth 2.0
Etsy|Commerce|https://developers.etsy.com|OAuth 2.0 (PKCE)
Mailchimp|Marketing|https://mailchimp.com/developer|OAuth 2.0, API key
Klaviyo|Marketing|https://developers.klaviyo.com|OAuth 2.0, private API key
SendGrid|Marketing|https://www.twilio.com/docs/sendgrid|API key
Brevo|Marketing|https://developers.brevo.com|API key
Marketo|Marketing|https://developer.adobe.com/marketo-apis/|OAuth 2.0 (client credentials)
ActiveCampaign|Marketing|https://developers.activecampaign.com|API key
Google Ads|Marketing|https://developers.google.com/google-ads/api|OAuth 2.0 + developer token
Meta Marketing API|Marketing|https://developers.facebook.com/docs/marketing-apis|OAuth 2.0 (Facebook Login), system user token
LinkedIn|Social|https://learn.microsoft.com/linkedin/|OAuth 2.0
X (Twitter)|Social|https://docs.x.com|OAuth 2.0, OAuth 1.0a
YouTube Data API|Social|https://developers.google.com/youtube/v3|OAuth 2.0, API key
Instagram Graph API|Social|https://developers.facebook.com/docs/instagram-platform|OAuth 2.0
TikTok|Social|https://developers.tiktok.com|OAuth 2.0
Reddit|Social|https://www.reddit.com/dev/api|OAuth 2.0
Discord|Communication|https://discord.com/developers/docs|Bot token, OAuth 2.0
Telegram Bot API|Communication|https://core.telegram.org/bots/api|Bot token
Twilio|Communication|https://www.twilio.com/docs|Account SID + auth token, API key
Zoom|Communication|https://developers.zoom.us|OAuth 2.0, Server-to-Server OAuth
WhatsApp Business Platform|Communication|https://developers.facebook.com/docs/whatsapp|System user token
Calendly|Productivity|https://developer.calendly.com|OAuth 2.0, personal access token
DocuSign|Productivity|https://developers.docusign.com|OAuth 2.0 (auth code, JWT)
Typeform|Productivity|https://www.typeform.com/developers|OAuth 2.0, personal token
SurveyMonkey|Productivity|https://developer.surveymonkey.com|OAuth 2.0
Figma|Design|https://www.figma.com/developers/api|OAuth 2.0, personal access token
Miro|Design|https://developers.miro.com|OAuth 2.0
Canva|Design|https://www.canva.dev|OAuth 2.0 (Connect APIs)
Workday|HR|https://community.workday.com|OAuth 2.0, ISU (varies by tenant)
BambooHR|HR|https://documentation.bamboohr.com|API key, OAuth
Gusto|HR|https://docs.gusto.com|OAuth 2.0
Greenhouse|HR|https://developers.greenhouse.io|API key (Basic auth)
Lever|HR|https://hire.lever.co/developer/documentation|OAuth 2.0, API key
Snowflake|Data|https://docs.snowflake.com/developer-guide/sql-api/|Key-pair JWT, OAuth
Google BigQuery|Data|https://cloud.google.com/bigquery/docs/reference/rest|Service account, OAuth 2.0
Amazon S3|Storage|https://docs.aws.amazon.com/s3/|AWS IAM (access keys, roles)
Supabase|Database|https://supabase.com/docs|API keys, service role key
Firebase|Database|https://firebase.google.com/docs|Service account, Firebase Auth
PostgreSQL|Database|https://www.postgresql.org/docs/|Database user (connection string)
Segment|Data|https://segment.com/docs/api/|Write key, API token
Mixpanel|Data|https://developer.mixpanel.com|Service account, project secret
Amplitude|Data|https://amplitude.com/docs/apis|API key + secret key
`.trim().split("\n");

const slug = (s) => s.toLowerCase().replace(/\(.*?\)/g, "").trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const apps = rows.map((r) => {
  const [name, category, docsUrl, authHint] = r.split("|");
  return { id: slug(name), name, category, docsUrl, authHint };
});
fs.writeFileSync(new URL("../data/directory.json", import.meta.url), JSON.stringify(apps, null, 2) + "\n");
console.log(`Wrote ${apps.length} apps`);
