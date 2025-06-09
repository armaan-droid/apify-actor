import { Actor } from 'apify';
import { PlaywrightCrawler, Session } from '@crawlee/playwright';

export const INPUT_SCHEMA = {
    schemaVersion: 1,
    title: 'Session Metamorph Actor Input',
    type: 'object',
    properties: {
        phpsessid: {
            title: 'PHP Session ID',
            type: 'string',
            description: 'The PHPSESSID cookie value to be preserved in the session',
            editor: 'textfield'
        },
        domain: {
            title: 'Cookie Domain',
            type: 'string',
            description: 'The domain for the PHPSESSID cookie (e.g., ".example.com")',
            editor: 'textfield'
        },
        innerInput: {
            title: 'Inner Actor Input',
            type: 'object',
            description: 'Input data to pass to the target actor after metamorphosis',
            editor: 'json'
        }
    },
    required: ['phpsessid', 'domain']
}; // keeps TypeScript quiet if you're on TS

await Actor.init();

const { phpsessid, domain, innerInput = {} } = await Actor.getInput();

/**
 * 1)  Spin up an ultra-light crawler only to create
 *     a Session that already contains the PHPSESSID cookie.
 *     No pages are actually scraped.
 */
const crawler = new PlaywrightCrawler({
    // Nothing to crawl; we just want the SessionPool persisted
    maxRequestsPerCrawl: 0,

    useSessionPool: true,
    persistCookiesPerSession: true,                 // SDK will keep cookies fresh :contentReference[oaicite:0]{index=0}
    sessionPoolOptions: {
        maxPoolSize: 1,                             // one "user" is enough
        createSessionFunction: (pool) => {
            const session = new Session({ sessionPool: pool });

            session.setCookies([{
                name: 'PHPSESSID',
                value: phpsessid,
                domain,                             // e.g. ".example.com"
                path: '/',
                httpOnly: true,
                secure: true,
            }]);

            return session;                         // cookie now lives in the SessionPool
        },
    },
});

// Actually open no pages – just initialise the pool
await crawler.run();

/**
 * 2)  Replace this running container with the private actor,
 *     preserving *all* default storages (Key-Value store, RequestQueue,
 *     Dataset – and most importantly our SessionPool).
 */
await Actor.metamorph(
    'dCWf2xghxeZgpcrsQ',   // target actor ID
    innerInput,            // whatever JSON that actor expects
);

// ⬆ Anything after metamorph never runs – the container is replaced
