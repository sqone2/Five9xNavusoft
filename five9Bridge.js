(() => {
    if (window.parent === window || !window.Five9?.CrmSdk) {
        return;
    }
    const interactionApi = window.Five9.CrmSdk.interactionApi();
    const getAccountId = (account) => {
        const accountId = typeof account?.id === 'string'
            ? /^navusoft-account:([1-9]\d*)$/.exec(account.id)?.[1] : undefined;
        return accountId && Number.isSafeInteger(Number(accountId)) ? accountId : null;
    };
    const noteWaiters = new Map();
    const finishedCalls = new Set();
    const savedNotes = new Map();
    const domainCavCatalogs = new Map();
    const getDomainCavs = async (call) => {
        const domainId = String(call.domainId || (await interactionApi.getMetadata()).tenantId || '');
        if (!/^[1-9]\d*$/.test(domainId)) {
            throw new Error('Five9 did not provide a valid domain ID for the CAV catalog');
        }
        if (!domainCavCatalogs.has(domainId)) {
            const loading = Promise.resolve().then(async () => {
                const result = await interactionApi.executeRestApi({
                    path: `/appsvcs/rs/svc/orgs/${domainId}/call_variables`, method: 'GET', payload: null
                });
                if (result?.status < 200 || result?.status >= 300 || !result?.status) {
                    throw new Error('Five9 could not retrieve the domain CAV catalog');
                }
                const definitions = typeof result.response === 'string' ? JSON.parse(result.response) : result.response;
                if (!Array.isArray(definitions) || definitions.some((variable) => !variable ||
                    !['string', 'number'].includes(typeof variable.id) || typeof variable.name !== 'string')) {
                    throw new Error('Five9 returned an invalid domain CAV catalog');
                }
                console.log('#### Five9 domain CAV definitions cached', { count: definitions.length });
                return definitions.map(({ id, name, group, type }) => ({ id, name, group, type }));
            }).catch((error) => {
                if (domainCavCatalogs.get(domainId) === loading) {
                    domainCavCatalogs.delete(domainId);
                }
                throw error;
            });
            domainCavCatalogs.set(domainId, loading);
        }
        return domainCavCatalogs.get(domainId);
    };
    const snapshotForDiagnostics = (data) => {
        const sensitiveField = /password|passphrase|secret|token|authorization|cookie|api[-_ ]?key|session[-_ ]?id|sso|assertion/i;
        return JSON.parse(JSON.stringify(data ?? null, function (key, value) {
            return sensitiveField.test(key) ||
                (key === 'value' && sensitiveField.test(String(this.name || this.key || '')))
                ? '[REDACTED]' : value;
        }));
    };
    const announceReady = () => window.parent.postMessage({
        source: 'five9-navusoft-adapter', type: 'BRIDGE_READY'
    }, 'https://bigssanitation.navusoft.net');
    const dialRequests = new Set();
    let dialing = false;
    window.addEventListener('message', (event) => {
        const request = event.data;
        if (event.source !== window.parent || event.origin !== 'https://bigssanitation.navusoft.net' ||
            request?.source !== 'five9-navusoft-extension') {
            return;
        }
        if (request.type === 'SAVE_CALL_NOTE_RESULT') {
            const waiter = noteWaiters.get(request.requestId);
            if (waiter) {
                clearTimeout(waiter.timeout);
                noteWaiters.delete(request.requestId);
                if (request.ok) {
                    waiter.resolve({ noteId: request.noteId, accountId: request.accountId });
                } else {
                    waiter.reject(new Error(request.error || 'Navusoft call note save failed'));
                }
            }
            return;
        }
        if (request.type === 'ACCOUNT_VISITED') {
            const account = request.account;
            if (!/^\d+$/.test(account?.id) || typeof account.name !== 'string' || !account.name) {
                return;
            }
            const crmObject = {
                id: `navusoft-account:${account.id}`,
                type: 'NavusoftAccount',
                label: 'Account',
                name: account.name,
                isWho: false,
                isWhat: true
            };
            Promise.resolve().then(() => interactionApi.objectVisited({ crmObject })).catch(() => {
                console.error('#### Could not register visited Navusoft account with Five9');
            });
            return;
        }
        if (request.type !== 'CLICK_TO_DIAL' ||
            typeof request.requestId !== 'string' || typeof request.number !== 'string' ||
            !/^\+?\d{7,15}$/.test(request.number) || dialRequests.has(request.requestId)) {
            return;
        }
        const respond = (ok, error) => window.parent.postMessage({
            source: 'five9-navusoft-adapter', type: 'CLICK_TO_DIAL_RESULT', requestId: request.requestId, ok, error
        }, 'https://bigssanitation.navusoft.net');
        if (dialing) {
            respond(false, 'A Five9 dial request is already in progress');
            return;
        }
        dialRequests.add(request.requestId);
        if (dialRequests.size > 256) {
            dialRequests.delete(dialRequests.values().next().value);
        }
        dialing = true;
        Promise.resolve().then(() => interactionApi.click2dial({
            click2DialData: {
                clickToDialNumber: request.number,
                defaultCampaign: false,
                useCurrentlySelectedCampaign: false
            }
        })).then(() => {
            respond(true);
            console.log('#### Five9 click-to-dial dispatched');
        }).catch(() => {
            respond(false, 'Five9 rejected click-to-dial. Check your login, station and campaign.');
            console.error('#### Five9 click-to-dial failed');
        }).finally(() => {
            dialing = false;
        });
    });
    const handled = new Set();
    const saveCallNote = (params) => {
        const call = params?.callData;
        const log = params?.callLogData;
        const interactionId = String(call?.interactionId || log?.sessionID || '');
        const accountId = getAccountId(log?.what);
        const disposition = log?.disposition?.name || log?.dispositionName;
        if (!interactionId || !accountId || !disposition) {
            return Promise.resolve();
        }
        const previous = savedNotes.get(interactionId);
        if (previous && !params.finalize) {
            return previous.then((result) => {
                if (result.accountId !== accountId) {
                    throw new Error('This call note was already saved to a different account');
                }
                return result;
            });
        }
        const lines = [
            'Five9 Call',
            `Call ID: ${call?.callId || interactionId}`,
            `Disposition: ${disposition}`,
            `Direction: ${call?.callType || 'Unknown'}`
        ];
        if (call?.number || call?.ani) {
            lines.push(`Phone: ${call.callType === 'INBOUND' ? call.ani || call.number : call.number || call.ani}`);
        }
        if (call?.agentName || call?.agent) {
            lines.push(`Agent: ${call.agentName || call.agent}`);
        }
        if (call?.campaignName) {
            lines.push(`Campaign: ${call.campaignName}`);
        }
        if (log.subject) {
            lines.push(`Subject: ${log.subject}`);
        }
        if (log.comment || log.comments) {
            lines.push('', String(log.comment || log.comments));
        }
        const note = lines.join('\n').slice(0, 32000);
        const saving = new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            const timeout = setTimeout(() => {
                noteWaiters.delete(requestId);
                reject(new Error('Navusoft did not acknowledge the call note; verify before retrying'));
            }, 30000);
            noteWaiters.set(requestId, { resolve, reject, timeout });
            window.parent.postMessage({
                source: 'five9-navusoft-adapter', type: 'SAVE_CALL_NOTE',
                requestId, interactionId, accountId, note, finalize: params.finalize === true
            }, 'https://bigssanitation.navusoft.net');
        });
        if (!params.finalize) {
            savedNotes.set(interactionId, saving);
        }
        if (savedNotes.size > 256) {
            savedNotes.delete(savedNotes.keys().next().value);
        }
        return saving;
    };
    window.Five9.CrmSdk.hookApi().registerApi({
        beforeDisposition: async (params) => {
            const proceed = { status: { statusCode: window.Five9.CrmSdk.HookStatusCode.Proceed } };
            const call = params?.interactionData;
            if (!['Call', 'PreviewCall', 'QueueCallback', 'SkillVoicemail'].includes(params?.interactionType)) {
                return proceed;
            }
            try {
                if (!call?.callId || !call.interactionId || call.callState === 'FINISHED' ||
                    finishedCalls.has(String(call.interactionId))) {
                    throw new Error('The call is no longer available for Navusoft CAV synchronization');
                }
                if (!await interactionApi.isMasterPage()) {
                    throw new Error('Disposition must run on the master Five9 instance');
                }
                const lookup = { interactionType: params.interactionType, interactionId: call.interactionId };
                let selected;
                try {
                    selected = await interactionApi.getSelectedRelatedToObject(lookup);
                    console.log('#### Five9 Related To selection retrieved', {
                        id: selected?.id ?? null,
                        name: selected?.name ?? null,
                        accountId: getAccountId(selected)
                    });
                } catch (error) {
                    if (error?.errorCode !== 'NoData') {
                        throw error;
                    }
                    console.log('#### Five9 returned no Related To account data; requesting disposition confirmation');
                }
                if (!getAccountId(selected)) {
                    console.log('#### No usable Navusoft account selected; requesting disposition confirmation');
                    return {
                        status: {
                            statusCode: window.Five9.CrmSdk.HookStatusCode.Confirmation,
                            messageHeader: 'No Account Selected',
                            message: 'No note will be saved because you have not selected an account. Do you want to proceed with disposition?'
                        },
                        params
                    };
                }
                console.log('#### Five9 disposition waiting for Navusoft note and call variables');
                const dispositions = await interactionApi.getDispositions(lookup);
                const disposition = dispositions.find((item) => String(item.id) === String(params.dispositionId));
                if (!disposition?.name) {
                    throw new Error('Five9 did not return the selected disposition');
                }
                if (finishedCalls.has(String(call.interactionId))) {
                    throw new Error('The call finished before its Navusoft note could be saved');
                }
                const result = await saveCallNote({
                    callData: call, callLogData: { what: selected, disposition }
                });
                try {
                    if (!/^[1-9]\d*$/.test(result.noteId) || !/^[1-9]\d*$/.test(result.accountId)) {
                        throw new Error('Navusoft saved the note but did not return valid note/account IDs');
                    }
                    if (finishedCalls.has(String(call.interactionId))) {
                        throw new Error('The call finished before its Navusoft CAVs could be updated');
                    }
                    const variables = await getDomainCavs(call);
                    const cavList = ['account_id', 'note_id'].map((name) => {
                        const matches = variables.filter((variable) => {
                            const group = typeof variable.group === 'string' ? variable.group.trim() : '';
                            const variableName = typeof variable.name === 'string' ? variable.name.trim() : '';
                            return (group === 'Navusoft' && variableName === name) ||
                                ((!variable.group || group === 'Navusoft') && variableName === `Navusoft.${name}`);
                        });
                        if (matches.length !== 1 || !matches[0].id) {
                            console.error('#### Five9 CAV definitions (values omitted):', JSON.stringify(variables.map((variable) => ({
                                id: variable.id,
                                group: typeof variable.group === 'string' ? variable.group : undefined,
                                groupType: typeof variable.group,
                                name: typeof variable.name === 'string' ? variable.name : undefined,
                                keys: Object.keys(variable)
                            }))));
                            throw new Error(`Five9 did not expose a unique Navusoft.${name} call variable in the domain catalog; see CAV definitions`);
                        }
                        return { id: matches[0].id, value: name === 'note_id' ? result.noteId : result.accountId };
                    });
                    if (finishedCalls.has(String(call.interactionId))) {
                        throw new Error('The call finished before its Navusoft CAVs could be updated');
                    }
                    await interactionApi.setCav({ interactionId: call.interactionId, cavList });
                    if (finishedCalls.has(String(call.interactionId))) {
                        throw new Error('The call finished before its Navusoft CAVs could be verified');
                    }
                    const confirmed = await interactionApi.getCav({
                        interactionId: call.interactionId, interactionSubType: call.interactionSubType
                    });
                    if (!cavList.every((expected) => confirmed.some((variable) =>
                        String(variable.id) === String(expected.id) && String(variable.value) === expected.value))) {
                        throw new Error('Five9 did not confirm the saved Navusoft call variable values');
                    }
                    if (finishedCalls.has(String(call.interactionId))) {
                        throw new Error('The call finished before its Navusoft CAVs could be verified');
                    }
                    console.log('#### Navusoft note and account call variables saved; allowing disposition');
                } catch (error) {
                    console.error('#### Navusoft CAV synchronization failed; allowing disposition:',
                        error?.message || error?.errorMessage || 'Unknown error');
                }
            } catch (error) {
                const message = error?.message || error?.errorMessage || 'Unknown error';
                console.error('#### Navusoft note/CAV synchronization failed; disposition blocked:', message);
                return { status: {
                    statusCode: window.Five9.CrmSdk.HookStatusCode.Error,
                    message: `Disposition blocked: ${message}. Verify the Navusoft note before retrying.`
                } };
            }
            return proceed;
        }
    });
    interactionApi.subscribe({
        callFinished: (params) => {
            try {
                console.log('#### Five9 disposition payload (credentials redacted):', snapshotForDiagnostics(params));
            } catch {
                console.error('#### Could not inspect Five9 disposition payload');
            }
            const call = params?.callData;
            const log = params?.callLogData;
            const interactionId = String(call?.interactionId || log?.sessionID || '');
            const accountId = getAccountId(log?.what);
            const disposition = log?.disposition?.name || log?.dispositionName;
            if (!interactionId || finishedCalls.has(interactionId)) {
                return;
            }
            if (!accountId || !disposition) {
                console.log('#### Skipping call note: select a valid Navusoft account in Related To and disposition the call');
                return;
            }
            finishedCalls.add(interactionId);
            if (finishedCalls.size > 256) {
                finishedCalls.delete(finishedCalls.values().next().value);
            }
            Promise.resolve().then(() => interactionApi.isMasterPage()).then((isMaster) => {
                if (!isMaster) {
                    return;
                }
                if (!savedNotes.has(interactionId)) {
                    console.error('#### Five9 bypassed the disposition hook; CAVs were not synchronized; saving note only');
                }
                if (savedNotes.has(interactionId)) {
                    return savedNotes.get(interactionId).then(() => saveCallNote({ ...params, finalize: true }));
                }
                return saveCallNote(params);
            }).catch((error) => {
                console.error('#### Navusoft call note failed:', error.message);
            });
        },
        callStarted: (params) => {
            announceReady();
            window.parent.postMessage({
                source: 'five9-navusoft-adapter',
                type: 'CALL_STARTED'
            }, 'https://bigssanitation.navusoft.net');
            const call = params?.callData;
            const isInbound = call?.callType === 'INBOUND';
            const isManual = call?.callType === 'AGENT' && !call.click2DialData?.clickToDialNumber;
            if ((!isInbound && !isManual) || !call.interactionId || handled.has(call.interactionId)) {
                return;
            }
            handled.add(call.interactionId);
            if (handled.size > 256) {
                handled.delete(handled.values().next().value);
            }
            Promise.resolve().then(() => interactionApi.isMasterPage()).then((isMaster) => {
                if (!isMaster) {
                    handled.delete(call.interactionId);
                    return;
                }
                window.parent.postMessage({
                    source: 'five9-navusoft-adapter',
                    type: isInbound ? 'INBOUND_CALL_STARTED' : 'MANUAL_CALL_STARTED',
                    interactionId: String(call.interactionId),
                    number: String(isInbound ? call.ani || call.number || '' : call.number || '')
                }, 'https://bigssanitation.navusoft.net');
                console.log('#### Five9 contact lookup requested', { callType: call.callType });
            }).catch(() => {
                handled.delete(call.interactionId);
                console.error('#### Could not process Five9 call contact lookup');
            });
        }
    });
    window.Five9.CrmSdk.applicationApi?.().subscribe({ sessionInitialized: () => {
        domainCavCatalogs.clear();
        announceReady();
    } });
    announceReady();
    console.log('#### Five9 Navusoft bridge ready');
})();