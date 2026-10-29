(() => {
    let activeRequestId = null;
    window.addEventListener('message', (event) => {
        const request = event.data;
        if (event.source !== window || event.origin !== location.origin ||
            request?.source !== 'five9-navusoft-extension' || request.type !== 'SEARCH_CONTACTS' ||
            typeof request.requestId !== 'string' || !/^\d{7,15}$/.test(request.phone)) {
            return;
        }
        activeRequestId = request.requestId;
        const respond = (result) => window.postMessage({
            source: 'five9-navusoft-api',
            requestId: request.requestId,
            ...result
        }, location.origin);
        if (!window.Ext?.Ajax?.request || !window.Portal?.model?.SharedData?.sessionId) {
            respond({ ok: false, error: 'Navusoft is not ready. Open the portal and sign in.' });
            return;
        }
        try {
            window.Ext.Ajax.request({
                url: '/rest/contact/search',
                method: 'GET',
                timeout: 15000,
                headers: {
                    Accept: 'application/json',
                    sessionId: window.Portal.model.SharedData.sessionId
                },
                params: {
                    query: request.phone,
                    searchKey: 'C',
                    searchType: '2',
                    searchSite: 'false',
                    searchContact: 'true'
                },
                success: (response) => {
                    let failureReason = 'Unexpected Navusoft contact search response';
                    try {
                        const contacts = JSON.parse(response.responseText)?.contacts?.contacts;
                        if (!Array.isArray(contacts)) {
                            throw new Error('Unexpected contact search response');
                        }
                        if (activeRequestId === request.requestId && contacts.length === 1 && contacts[0].siteId) {
                            failureReason = 'Navusoft record navigation failed';
                            const portal = window.Portal;
                            const mainCard = window.Ext.ComponentQuery.query('#mainCard')[0];
                            const view = mainCard?.getLayout().getActiveItem() ||
                                window.Ext.getCmp(portal.util.Constants.CARD_CUSTOMER_SEARCH);
                            if (!view || typeof portal.util.Common.displayCustomerScreen !== 'function') {
                                throw new Error('Navusoft record navigation is unavailable');
                            }
                            portal.util.Common.displayCustomerScreen(view, portal.util.Constants.CARD_CUSTOMER_SEARCH, contacts[0].siteId);
                        } else if (activeRequestId === request.requestId && contacts.length > 1) {
                            failureReason = 'Navusoft Contacts results navigation failed';
                            const portal = window.Portal;
                            const application = portal.getApplication?.() || portal.app || window.Ext.app?.Application?.instance;
                            const controller = application?.getController('search.CustomerSearchController');
                            const mainCard = window.Ext.ComponentQuery.query('#mainCard')[0];
                            const panel = window.Ext.getCmp(portal.util.Constants.CARD_CUSTOMER_SEARCH);
                            const searchType = panel?.down('combo[name=searchtype]');
                            const searchText = panel?.down('trigger[name=searchText]');
                            if (!mainCard || !searchType || !searchText ||
                                typeof controller?.onChangeSearchType !== 'function' || typeof controller?.submitSearch !== 'function') {
                                throw new Error('Navusoft Contacts search is unavailable');
                            }
                            mainCard.getLayout().setActiveItem(portal.util.Constants.CARD_CUSTOMER_SEARCH);
                            searchType.setValue('C');
                            controller.onChangeSearchType(searchType);
                            searchText.setValue(request.phone);
                            controller.submitSearch(panel);
                        }
                        respond({
                            ok: true,
                            contacts: contacts.map((contact) => ({
                                id: String(contact.id ?? ''),
                                name: String(contact.name || 'Unnamed contact'),
                                siteId: String(contact.siteId ?? ''),
                                siteName: String(contact.sitename || '')
                            }))
                        });
                    } catch {
                        respond({ ok: false, error: failureReason });
                    }
                },
                failure: (response) => respond({ ok: false, error: `Navusoft contact search failed (${response.status || 'network error'})` })
            });
        } catch {
            respond({ ok: false, error: 'Could not start Navusoft contact search' });
        }
    });
    console.log('#### Navusoft authenticated Contacts bridge ready');
})();