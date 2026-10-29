# Privacy Policy for Five9xNavusoft

Effective date: October 29, 2026

Five9xNavusoft is a Chrome extension that embeds Five9 Agent Desktop in the configured Navusoft portal and connects call activity with Navusoft contact searches and account notes. This policy describes how the extension handles information. Your organization's use of Five9 and Navusoft is also subject to its agreements and those services' privacy policies.

## Information the Extension Handles

To provide the integration, the extension accesses and processes:

- Phone numbers supplied by Five9 for inbound and manually dialed calls, to search Navusoft contacts.
- Contact search results, including contact names, contact IDs, site names, and site IDs, to locate and open matching records.
- Names and internal IDs of accounts opened in Navusoft, to make those accounts available in Five9's Related To selection.
- Call and interaction IDs, direction, disposition, phone number, agent identity, campaign, subject, and comments when supplied by Five9, to create or update an account-level call note.
- Five9 domain and call-variable definitions, plus saved account and note IDs, to associate the call with the saved Navusoft record.
- The existing Navusoft session identifier and signed-in user ID, to authenticate requests and identify the author of a note. The extension does not request or store your password or create a separate extension login.

Processing can occur automatically when calls start or finish and when accounts are opened. Saving a call note depends on a valid Navusoft account selection in Five9 and the call's disposition information.

## How Information Is Used and Shared

The extension uses information only to provide and troubleshoot its Five9-to-Navusoft integration:

- Caller or dialed phone numbers are sent to the configured Navusoft portal for contact searches.
- Visited Navusoft account names and IDs are provided to Five9 for account selection.
- Call details and comments from Five9 are sent to Navusoft to create or update a note on the selected account.
- Saved Navusoft account and note IDs are written to the corresponding Five9 call variables when available.

The extension has no separate publisher-operated backend for collecting this information. It does not include advertising or analytics integrations, sell personal information, or use it for advertising, creditworthiness, or unrelated profiling. It does not track browsing activity outside its configured Navusoft and Five9 pages.

The extension's use and transfer of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Browser Access and Calling

The extension runs on its configured Navusoft portal and the Five9 Agent Desktop page. It reads relevant page data and exchanges messages between those pages to provide the integration.

The embedded Five9 application may request microphone access for calls and use cookies or other browser storage for its own operation. The extension does not itself capture microphone audio, create audio recordings, or retrieve call transcripts. Audio handling, recording, and any other data processing performed by Five9 are governed by your organization's Five9 configuration and applicable policies.

## Storage and Retention

The extension keeps working data in page memory, including visited accounts, call-processing state, note records, and cached Five9 call-variable definitions. Page-memory data is normally released when the page is closed or reloaded; call-variable definitions are also cleared when a Five9 session initializes.

To prevent duplicate notes, the extension stores call interaction IDs, attempted or saved status, and saved note and account IDs in the Navusoft page's browser session storage. This data survives page reloads and is generally removed when the tab's browsing session ends, subject to browser session-restoration behavior. Note contents and authentication credentials are not written to this duplicate-prevention storage. The extension does not use Chrome extension storage to retain customer data.

The extension writes diagnostic messages to the browser developer console. These can include account names and IDs and a final call payload containing customer and call information. Credential-like fields in that payload are redacted, but this is not full anonymization. Console data may remain available depending on browser settings and can be copied or exported by someone with access to the browser. Review and redact diagnostics before sharing them.

Notes and call-variable values saved to Navusoft or Five9 remain in those services according to your organization's and the providers' retention policies. Removing the extension does not delete those records or necessarily clear page session storage or console logs.

## Security and Your Choices

The integration uses HTTPS service pages and requests, existing authenticated sessions, and origin checks for cross-page messages. No method of transmission or storage is completely secure.

You can stop the extension's processing by disabling or uninstalling it. You can manage microphone access in Chrome's site settings and clear the Navusoft site's session storage through browser controls. Clearing duplicate-prevention data can remove protection against saving the same call note again. To access, correct, or delete information saved in Five9 or Navusoft, contact your organization's administrator or the relevant service provider.

## Changes and Contact

This policy may be updated when the extension's data handling changes. Updates will be published here with a revised effective date.

For privacy questions about the extension, use the developer contact information provided on the Five9xNavusoft Chrome Web Store listing. For questions about your organization's customer records, call recordings, or retention requirements, contact your organization's administrator.