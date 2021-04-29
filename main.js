let contractName = "app.nearcrowd.near";
let appName = "NEAR Crowd";

window.nearConfig = {
    networkId: 'mainnet',
    nodeUrl: 'https://rpc.mainnet.near.org',
    contractName: contractName,
    walletUrl: 'https://wallet.near.org',
    helperUrl: 'https://helper.mainnet.near.org'
};

function _(a) {
    return document.getElementById(a);
}

function hex(b) {
    return b.map(x => ("0" + x.toString(16)).slice(-2)).join('');
}

function ff(response) {
    if (!response.ok) {
        response.text().then(text => {
            if (text.startsWith('Traceback')) {
                text = text.trim().split('\n').splice(-1)[0];
            }
            errorOut(Error("Request to server failed with: " + response.statusText + "\n\n" + text))
        })
    }
    return response.text()
}

function formatBalance(x) {
    let a = x.substring(0, x.length - 24);
    let b = x.substring(x.length - 24, x.length - 22);
    if (a.length == 0) a = "0";
    if (b.length == 0) b = "00";
    if (b.length == 1) b = "0" + b;
    return a + "." + b;
}

function hideAll(keepTitle) {
    if (!keepTitle) {
        _('tdTitle').innerText = 'Ⓝ🧑‍🤝‍🧑';
    }
    for (let el of document.getElementsByClassName('tabGroupMain')) {
        el.style.display = 'none';
    }
}

function allowancePostprocess(s) {
    if (s.indexOf('NotEnoughAllowance') != -1) {
        return "Your access key ran out of gas allowance. Please log out and log in again to continue."
    }
    return s;
}

function errorOut(e) {
    hideAll(true);
    _('divFailure').style.display = '';
    if (e['message']) {
        let m = e['message'].replaceAll('&#39;', '"');
        let pos = m.indexOf(', src');
        if (pos != -1) {
            m = m.substr(0, pos);
        }

        _('spanErrorMessage').innerText = allowancePostprocess(m);
    } else {
        _('spanErrorMessage').innerText = allowancePostprocess(e);
    }
    for (let k in e) {
        console.log(k);
    }
    console.error(typeof e);
    console.error(e);
}

function signIn() {
    walletAccount.requestSignIn(
      // The contract name that would be authorized to be called by the user's account.
      contractName,
      appName
      // We can also provide URLs to redirect on success and failure.
      // The current URL is used by default.
    );
}

function signOut() {
    walletAccount.signOut();
    // Forcing redirect.
    window.location.replace(window.location.origin + window.location.pathname);
}

async function connect() {
    window.near = await nearApi.connect(Object.assign(nearConfig, { deps: { keyStore: new nearApi.keyStores.BrowserLocalStorageKeyStore() }}));
  
    // Needed to access wallet login
    window.walletAccount = new nearApi.WalletConnection(window.near);
    window.accountId = walletAccount.getAccountId();
  
    // Initializing our contract APIs by contract name and configuration.
    window.contract = await near.loadContract(nearConfig.contractName, {
        viewMethods: ['is_account_whitelisted', 'get_current_taskset', 'get_estimated_atto_tasks_per_share', 'get_account_state', 'get_account_stats', 'get_task_review_state', 'get_taskset_state'],
        changeMethods: ['claim_reward', 'change_taskset', 'apply_for_assignment', 'claim_assignment', 'return_own_review', 'remove_duplicate_review', 'submit_approved_solution', 'submit_solution', 'submit_review', 'honeypot_partial_credit', 'finalize_task', 'finalize_challenged_task', 'challenge', 'invite_friend'],
        sender: window.walletAccount.getAccountId()
    });
  
	_('divLoading').style.display = 'none';
    if (!walletAccount.isSignedIn()) {
		_('divSignedOut').style.display = '';
    } else {
		_('divSignedIn').style.display = '';
        _('tdName').innerHTML = window.walletAccount.getAccountId();
        _('tdName2').innerHTML = window.walletAccount.getAccountId();

        window.contract.is_account_whitelisted({'account_id': window.walletAccount.getAccountId()}).then(m => { if (m) { loadTaskSet() } else { _('divNotApproved').style.display = ''; } }).catch(errorOut);
    }
}

function loadTask() {
    hideAll();
    _('tdTitle').innerHTML = window.taskset.name.bold() + ' ' + window.taskset.name_extra + ' <a href=# onclick="showTaskSelection()">Change</a>';
    showLoading('Loading task...');
    window.contract.get_account_state({'account_id': window.walletAccount.getAccountId(), 'task_ordinal': window.task_ordinal}).then(accountStateFetched).catch(errorOut);
}

function showAssignment(raw_data) {
    let data = JSON.parse(raw_data);

    if (data["type"] == "regular") {
        hideAll(true);
        let honeypot_data = {'is_honeypot': data['is_honeypot'], 'honeypot_preimage': data['honeypot_preimage']};
        _('divAssignment').style.display = '';
        window.solution_data = tasksets[window.task_ordinal].fn(_('divAssignment'), window.task_hash, data['data'], null, honeypot_data);
    } else if (data["type"] == "review") {
        hideAll(true);
        let honeypot_data = {'is_honeypot': false, 'honeypot_preimage': ""};
        _('divAssignment').style.display = '';
        window.solution_data = tasksets[window.task_ordinal].fn(_('divAssignment'), window.task_hash, data, JSON.parse(data['solution']), honeypot_data);
    } else {
        throw "Unknown type of the assignment " + data["type"]
    }

    if (!window.localStorage.getItem("taskTypesSeen")) {
        showTaskTypeHelp(true);
    }

    else if (!window.localStorage.getItem("taskHelpSeen" + window.task_ordinal)) {
        tasksets[window.task_ordinal].help_fn(_('divAssignment'));
    }
}

function submitSolutionToChain(solution_hash_str) {
    let solution_hash = JSON.parse(solution_hash_str);
    showLoading('Submitting to the chain...');
    window.contract.submit_approved_solution({'task_ordinal': window.task_ordinal, 'solution_hash': solution_hash}).then(loadTask).catch(errorOut);
}

function submitSolutionInner(honeypot_descr, solution_data) {
    
    showLoading('Submitting solution to the task server...');
    window.contract.account.signTransaction('app.nearcrowd.near', [nearApi.transactions.functionCall('submit_solution', {'task_ordinal': window.task_ordinal, 'solution_data': JSON.stringify(solution_data)}, 0, 0)]).then(arr => {
        let encodedTx = btoa(String.fromCharCode.apply(null, arr[1].encode()));
        fetch('/solution/' + encodeURIComponent(honeypot_descr) + '/' + encodeURIComponent(encodedTx)).then(response => ff(response).then(submitSolutionToChain).catch(errorOut)).catch(errorOut);
    }).catch(errorOut);
}

function showFailedTasksInternal(data) {
    data = JSON.parse(data);
    if (data.length == 0) {
        errorOut("No failures to show");
        return;
    }

    hideAll(true);
    _('divReviewFailures').style.display = '';
    _('divReviewFailures').innerHTML = '<b>Last ' + data.length + ' failures: </b>';

    let here = document.createElement('span');

    function showFailureN(n) {
        let r = data[n];
        here.innerHTML = 'A failure makes no sense? Post it <a href="https://t.me/nearcrowdpublic">on Telegram</a><br><br>';
        tasksets[r.task_ordinal].inner_fn(here, 0, {'data': r.data, 'failure_details': {'is_honeypot': r.is_honeypot, 'reason': r.reason, 'what': r.what, 'final_verdict': r.final_verdict}}, JSON.parse(r.solution), null, true, true);
    }

    for (let i = 0; i < data.length; ++ i) {
        let a = document.createElement('a');
        a.href = '#';
        a.style.marginRight = '7px';
        a.style.marginLeft = '7px';
        a.innerText = 1 + i;
        a.onclick = function() { showFailureN(i) }
        _('divReviewFailures').appendChild(a);
    }
    _('divReviewFailures').appendChild(document.createElement('br'));
    _('divReviewFailures').appendChild(document.createElement('br'));

    _('divReviewFailures').appendChild(here);

    showFailureN(0);
}

function showFailedTasks() {
    _('divBurger').style.display = 'none';
    showLoading("Loading failures...");
    window.contract.account.signTransaction('app.nearcrowd.near', [nearApi.transactions.functionCall('get_failures', {}, 0, 0)]).then(arr => {
        let encodedTx = btoa(String.fromCharCode.apply(null, arr[1].encode()));
        fetch('/failures/' + encodeURIComponent(encodedTx)).then(response => ff(response).then(showFailedTasksInternal).catch(errorOut)).catch(errorOut);
    }).catch(errorOut);
}

function submitSolution() {
    submitSolutionInner('', window.solution_data);
}

function postReviewSubmission(x) {
    x = JSON.parse(x);
    if (!x.can_partial) {
        loadTask();
    } else {
        hideAll(true);
        _('spanPartialHoneypotReason').innerText = x['reason'];
        _('divPartialCredit').style.display = '';
    }
}

function submitReview(approve, rejection_reason) {
    showLoading('Submitting review to the task server...');
    window.contract.account.signTransaction('app.nearcrowd.near', [nearApi.transactions.functionCall('submit_review', {'task_ordinal': window.task_ordinal, 'approve': approve, 'rejection_reason': rejection_reason}, 200000000000000, 0)]).then(arr => {
        let encodedTx = btoa(String.fromCharCode.apply(null, arr[1].encode()));
        fetch('/review/' + encodeURIComponent(encodedTx)).then(response => ff(response).then(postReviewSubmission).catch(errorOut)).catch(errorOut);
    }).catch(errorOut);
}

function partialCredit() {
    showLoading('Claiming partial credit...');
    window.contract.honeypot_partial_credit({'task_ordinal': window.task_ordinal, 'task_hash': window.task_hash}).then(loadTask).catch(errorOut);
}

function submitHoneypotFn(el) {
    return function() {
        let honeypotDescr = el.value.trim();
        if (el.value == "") {
            alert("The description of the mistake cannot be empty");
        } else {
            submitSolutionInner(el.value, window.solution_data);
        }
    }
}

function fetchTaskFromServer(taskHash) {
    console.log(JSON.stringify(taskHash));
    window.contract.account.signTransaction('app.nearcrowd.near', [nearApi.transactions.functionCall('request_task_from_server', {'task_ordinal': window.task_ordinal, 'task_hash': taskHash}, 0, 0)]).then(arr => {
        let encodedTx = btoa(String.fromCharCode.apply(null, arr[1].encode()));
        fetch('/get_task/' + encodeURIComponent(encodedTx)).then(response => ff(response).then(showAssignment).catch(errorOut)).catch(errorOut);
    }).catch(errorOut);
}

function claimTask(bid) {
    showLoading('Claiming task...');
    window.contract.claim_assignment({'task_ordinal': window.task_ordinal, 'bid': bid}).then(m => { if (m) { hideAll(true); _('divTasksetCompleted').style.display = ''; } else { setTimeout(loadTask, 1000) } }).catch(errorOut);
}

function countdown(nanosec, bid) {
    _('divWaitingForAssignment').style.display = '';
    nanosec = parseFloat(nanosec);
    let started = new Date().getTime();
    let update = function() {
        let wait = Math.ceil(nanosec / 1000000000.0 + (started - new Date().getTime()) / 1000.0);
        if (wait <= 0) {
            claimTask(bid);
        } else {
            _('spanCountdown').innerHTML = "<b>" + wait + "</b> seconds";
            setTimeout(update, 100);
        }
    }
    update();
}

function accountStateFetched(account_state) {
    let account_state_str = account_state;
    let val = null;
    if (typeof account_state_str == "object") {
        for (let k in account_state) {
            account_state_str = k;
            val = account_state[k];
        }
    }
    if (account_state_str == 'Idle') {
        showLoading('No assigned task. Applying...');
        window.contract.apply_for_assignment({'task_ordinal': window.task_ordinal}).then(loadTask).catch(errorOut);
    } else if (account_state_str == "WaitsForAssignment") {
        hideAll(true);
        if (val.time_left == 0) {
            claimTask(val.bid);
        } else {
            countdown(val.time_left, val.bid);
        }
    } else if (account_state_str == "HasAssignment") {
        showLoading('Fetching task...');
        let assignment = val['assignment'];
        window.task_hash = assignment.task_hash;
        window.task_bid = val.bid;
        fetchTaskFromServer(window.task_hash);
    } else {
        throw {'message': "Unknown account state: " + account_state_str, 'account_state': account_state};
    }
}

function showTaskSelection() {
    hideAll();
    _('divTaskSelection').style.display = '';
    _('tdTitle').innerHTML = "Task selection".bold();

    for (let i = 0; i < tasksets.length; ++ i) {
        let taskset = tasksets[i];
        _('spanTaskSetStats' + taskset.ordinal).innerText = '...';
        window.contract.get_taskset_state({'task_ordinal': taskset.ordinal}).then(s => _('spanTaskSetStats' + taskset.ordinal).innerHTML = 'Reward: <b>Ⓝ ' + formatBalance(s['next_price']) + '</b>; Tasks left: <b>' + s['num_unassigned'] + (s['num_reviews'] == 0 ? '' : '-' + (parseInt(s['num_unassigned']) + parseInt(s['num_reviews'])) + '</b>'));
    }
}

function chooseTaskset(task_ord) {
    showLoading('Choosing taskset...');
    window.contract.change_taskset({'new_task_ord': task_ord}).then(m => { loadTaskSet() }).catch(errorOut);
}

function loadTaskSet() {
    window.contract.get_current_taskset({'account_id': window.walletAccount.getAccountId()}).then(m => { if (m == null) { showTaskSelection(); } else { window.task_ordinal = m; window.taskset = tasksets[m]; loadTask(); } }).catch(errorOut);
}

function showTaskTypeHelp(first_time) {
    hideAll(true);
    if (first_time) {
        _('divTaskTypesHelpFirstTime').style.display = '';
    } else {
        _('divTaskTypesHelpFirstTime').style.display = 'none';
    }
    _('divTaskTypesHelp').style.display = '';
}

function closeTaskTypesHelp() {
    window.localStorage.setItem("taskTypesSeen", true);
    loadTask();
}

function showLoading(w) {
    hideAll(true);
    _('divLoading2').style.display = '';
    _('spanLoadingInner').innerText = w;
}

function postWithdrawal() {
    hideAll(true);
    _('divWithdrawalSuccessful').style.display = '';
}

function showBurger() {
    _("divAccountStats").innerHTML = '<i>Loading...<br><br></i>';
    window.contract.get_account_stats({'account_id': window.walletAccount.getAccountId()}).then(function(x) {
        _("divAccountStats").innerHTML = "<table style='text-align: left'><tr><td>Successful Tasks: </td><td align=right><b>" + x.successful + "</b></td></tr><tr><td>Failed Tasks: </td><td align=right><a href='#' onclick='showFailedTasks()'>" + x.failed + "</a></td></tr><tr><td>Pending Review: </td><td align=right><b>" + x.pending + "</b></td></tr><tr><td>Reward: </td><td align=right><b>Ⓝ " + formatBalance(x.balance) + "</b></td></tr>" + ((x.invites > 0) ? "<tr><td>Invites:</td><td align=right><b>" + x.invites + "</b></td></tr>" : "") + "</table>";
        if (x.balance > 0 || true) {
            var btn = document.createElement('button');
            btn.onclick = function() {
                if (x.successful + x.failed < 20) {
                    alert('You need to have ' + (20 - x.successful - x.failed) + ' more tasks completed before you can withdraw.');
                } else if (x.successful * 100 < (x.successful + x.failed) * 80) {
                    alert('Your ratio of successul tasks to failed is too low. The success rate must be at least 80% to withdraw.');
                } else {
                    _("divAccountStats").innerText = 'Withdrawing...';
                    window.contract.claim_reward({}).then(function() { _("divAccountStats").innerText = 'Withdrawal successful!'; postWithdrawal(); }).catch(errorOut);
                }
            }
            btn.innerHTML = 'Withdraw Reward';
            _("divAccountStats").appendChild(btn);
            _("divAccountStats").appendChild(document.createElement('br'));
        }
        if (x.invites > 0) {
            var span = document.createElement('span');
            span.innerHTML = "<small>Invite a friend to NEARCrowd,<br>and receive 5% of all their rewards!</small><br><br>"
            var btn = document.createElement('button');
            btn.onclick = function() {
                let s = prompt("What is your friends NEAR account?");
                if (s) {
                    s = s.trim().toLowerCase();
                    if (!s.endsWith(".near") && s.length != 64) {
                        alert("This is not a valid NEAR account ID. Account ID must either end with '.near', or be exactly 64 characters long.");
                    } else {
                        _("divAccountStats").innerText = 'Inviting...';
                        window.contract.invite_friend({'account_id': s}).then(function() { alert(s +" is good to go!"); _("divBurger").style.display = "none"; }).catch(errorOut);
                    }
                }
            }
            btn.innerHTML = 'Invite a friend';
            _("divAccountStats").appendChild(document.createElement('hr'));
            _("divAccountStats").appendChild(span);
            _("divAccountStats").appendChild(btn);
            _("divAccountStats").appendChild(document.createElement('br'));
        }
    });
    _("divBurger").style.display = "";
}

function howItWorks() {
    _('divSignedOut').style.display = 'none';
    _('divSignedIn').style.display = 'none';
    _('divHowItWorkd').style.display = '';
}

hideAll();
window.nearInitPromise = connect()
    .catch(console.error);

setTimeout(function() {
    let s = 'New tasks are added every several hours.<br><br>';
    for (var i = 0; i < tasksets.length; ++ i) {
        let taskset = tasksets[i];
        s += (i + 1) + ': ' + taskset.name.bold() + ' ' + taskset.name_extra + '<br>';
        s += ('<span id=spanTaskSetStats' + taskset.ordinal) + '>...</span><br>';
        s += ('Requirements: ' + taskset.requirements).italics() + '<br>';
        s += '<button onclick="chooseTaskset(' + taskset.ordinal + ')">Choose</button><br><br>';

    }
    _('divTaskSelection').innerHTML = s;
}, 0)

