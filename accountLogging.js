(() => {
    const accounts = new Map();
    const savedRecords = new Map();
    const ledgerKey = 'five9-navusoft-call-notes';
    let publishCurrentAccount = () => {};

    const publish = (account) => window.postMessage({
        source: 'five9-navusoft-api', type: 'ACCOUNT_VISITED', account
    }, location.origin);

    const attach = () => {
        const ext = window.Ext;
        const portal = window.Portal;
        const store = ext?.data?.StoreManager?.lookup('customerSiteStore');
        const detail = portal?.util?.Constants && ext?.getCmp(portal.util.Constants.CARD_CUSTOMER_DETAIL);
        if (!store || !detail) {
            setTimeout(attach, 500);
            return;
        }
        let lastAccount = null;
        publishCurrentAccount = () => {
            const active = ext.ComponentQuery.query('#mainCard')[0]?.getLayout().getActiveItem();
            const record = store.getAt(0);
            if (active !== detail || !record || Number(record.get('account-access')) !== 1) {
                return;
            }
            const account = { id: String(record.get('account-id') || ''), name: String(record.get('account-name') || '') };
            if (!/^\d+$/.test(account.id) || !account.name) {
                return;
            }
            const signature = JSON.stringify(account);
            accounts.set(account.id, account);
            if (signature !== lastAccount) {
                lastAccount = signature;
                publish(account);
            }
        };
        store.on('load', (loadedStore, records, successful) => {
            if (successful) {
                setTimeout(publishCurrentAccount, 0);
            }
        });
        detail.on('activate', () => setTimeout(publishCurrentAccount, 0));
        detail.on('deactivate', () => { lastAccount = null; });
        publishCurrentAccount();
        console.log('#### Navusoft account visit tracking ready');
    };

    window.addEventListener('message', (event) => {
        const request = event.data;
        if (event.source !== window || event.origin !== location.origin || request?.source !== 'five9-navusoft-extension') {
            return;
        }
        if (request.type === 'REQUEST_ACCOUNT_VISITS') {
            publishCurrentAccount();
            accounts.forEach(publish);
            return;
        }
        if (request.type !== 'SAVE_CALL_NOTE' || typeof request.requestId !== 'string' ||
            typeof request.interactionId !== 'string' || !request.interactionId || request.interactionId.length > 200 ||
            typeof request.accountId !== 'string' || !/^[1-9]\d*$/.test(request.accountId) ||
            !Number.isSafeInteger(Number(request.accountId)) ||
            typeof request.note !== 'string' || !request.note.trim() || request.note.length > 32000) {
            return;
        }
        const respond = (ok, error, duplicate = false, noteId) => window.postMessage({
            source: 'five9-navusoft-api', type: 'SAVE_CALL_NOTE_RESULT', requestId: request.requestId,
            ok, error, duplicate, noteId, accountId: request.accountId
        }, location.origin);
        const portal = window.Portal;
        if (!portal?.model?.SharedData?.sessionId || !window.Ext?.create) {
            respond(false, 'Navusoft is not ready to save a call note');
            return;
        }
        let ledger;
        try {
            ledger = JSON.parse(sessionStorage.getItem(ledgerKey) || '{}');
            if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
                throw new Error('Invalid note ledger');
            }
            if (Object.hasOwn(ledger, request.interactionId)) {
                const entry = ledger[request.interactionId];
                const saved = entry === 'saved' || entry?.status === 'saved';
                if (entry?.accountId && entry.accountId !== request.accountId) {
                    respond(false, 'This call note was already saved to a different account', true);
                    return;
                }
                if (saved && request.finalize === true) {
                    const record = savedRecords.get(request.interactionId);
                    if (!record) {
                        respond(false, 'The saved note is unavailable for final comments; verify Navusoft', true);
                        return;
                    }
                    record.set('note', request.note);
                    record.proxy.headers.sessionId = portal.model.SharedData.sessionId;
                    record.proxy.appendId = true;
                    record.save({ callback: (updated, operation) => {
                        respond(operation.wasSuccessful(), operation.wasSuccessful() ? undefined :
                            'Navusoft could not confirm the final call note update', true, entry.noteId);
                    } });
                    return;
                }
                respond(saved, saved ? undefined : 'This call note was already attempted; verify Navusoft before retrying', true, entry?.noteId);
                return;
            }
            if (request.finalize === true) {
                respond(false, 'No saved call note exists to finalize');
                return;
            }
        } catch {
            respond(false, 'Call note duplicate protection is unavailable');
            return;
        }
        const noteType = portal.model.StaticReferenceData.getNoteTypesStore().getRange().find((record) =>
            Number(record.get('type')) === 1 && String(record.get('name')).trim().toLowerCase() === 'service note');
        if (!noteType) {
            respond(false, 'Configure an account-level Service Note type in Navusoft');
            return;
        }
        try {
            const note = window.Ext.create('Portal.model.note.Note');
            note.set({
                accountId: Number(request.accountId),
                typeId: noteType.get('id'),
                createdbyusrId: portal.model.SharedData.usrId,
                clientTimestamp: new Date(),
                uuid: portal.util.Formatter.generateUUID(),
                note: request.note
            });
            note.proxy.headers.sessionId = portal.model.SharedData.sessionId;
            note.proxy.appendId = false;
            ledger[request.interactionId] = 'attempted';
            sessionStorage.setItem(ledgerKey, JSON.stringify(ledger));
            note.save({
                callback: (record, operation) => {
                    if (!operation.wasSuccessful()) {
                        respond(false, 'Navusoft could not confirm the call note was saved; verify before retrying');
                        return;
                    }
                    const validId = (value) => ['string', 'number'].includes(typeof value) &&
                        /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
                    let returnedId = record?.getId?.();
                    if (!validId(returnedId)) {
                        try {
                            returnedId = JSON.parse(operation.response?.responseText || 'null');
                        } catch {
                            returnedId = null;
                        }
                    }
                    const noteId = validId(returnedId) ? String(returnedId) : '';
                    if (noteId) {
                        record.setId(Number(noteId));
                        record.phantom = false;
                        record.commit();
                    }
                    savedRecords.set(request.interactionId, record);
                    if (savedRecords.size > 256) {
                        savedRecords.delete(savedRecords.keys().next().value);
                    }
                    try {
                        const latest = JSON.parse(sessionStorage.getItem(ledgerKey) || '{}');
                        latest[request.interactionId] = { status: 'saved', noteId, accountId: request.accountId };
                        sessionStorage.setItem(ledgerKey, JSON.stringify(latest));
                    } catch {
                        console.error('#### Could not update saved call note marker');
                    }
                    respond(true, undefined, false, noteId);
                    console.log('#### Navusoft call note saved');
                    try {
                        const current = window.Ext.data.StoreManager.lookup('customerSiteStore')?.getAt(0);
                        if (String(current?.get('account-id')) === request.accountId) {
                            const detail = window.Ext.getCmp(portal.util.Constants.CARD_CUSTOMER_DETAIL);
                            const stores = [
                                window.Ext.data.StoreManager.lookup('note.NoteBySite'),
                                detail?.down('pendingactivitygrid')?.getStore()
                            ];
                            for (const store of new Set(stores)) {
                                if (!store?.lastOptions) {
                                    continue;
                                }
                                try {
                                    store.reload();
                                } catch {
                                    console.error('#### Call note saved, but a loaded Navusoft activity store could not refresh');
                                }
                            }
                        }
                    } catch {
                        console.error('#### Call note saved, but the Navusoft activity refresh failed');
                    }
                }
            });
        } catch {
            respond(false, 'Could not save the Navusoft call note; verify before retrying');
        }
    });
    attach();
})();