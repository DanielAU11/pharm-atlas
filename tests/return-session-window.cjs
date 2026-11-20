const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: { contextIsolation: false, nodeIntegration: false }
    });
    await win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
    await new Promise(resolve => setTimeout(resolve, 400));
    const fixtureSource = fs.readFileSync(path.join(__dirname, 'demo-fixture.js'), 'utf8');
    await win.webContents.executeJavaScript(`${fixtureSource}\nwindow.installPharmAtlasDemoFixture()`);
    const result = await win.webContents.executeJavaScript(`(() => {
        const med = db.inventory[0];
        activeReturnPrepackSession = createReturnPrepackSession();
        const rowA = { med, item: { medId: med.id }, queue: { memberName: 'Member A' }, day: { date: '2026-11-19' } };
        const separateMemberMed = { ...med, id: 'same-medication-separate-inventory-record' };
        const rowB = { med: separateMemberMed, item: { medId: separateMemberMed.id }, queue: { memberName: 'Member B' }, day: { date: '2026-11-20' } };
        activeReturnPrepackSession.labelRows.push({ row: rowA, qty: 1 }, { row: rowB, qty: 2 });
        activeReturnPrepackSession.events.push(
            { handling: 'return', medId: med.id, medName: med.name, strength: formatLabelMedStrength(med), formulation: med.formulation, unit: med.administrationUnit || inventoryUnitFor(med), qty: 1, packageKey: 'a', memberName: 'Member A' },
            { handling: 'return', medId: separateMemberMed.id, medName: separateMemberMed.name, strength: formatLabelMedStrength(separateMemberMed), formulation: separateMemberMed.formulation, unit: separateMemberMed.administrationUnit || inventoryUnitFor(separateMemberMed), qty: 2, packageKey: 'b', memberName: 'Member B' }
        );
        document.documentElement.classList.remove('mobile-runtime');
        document.body.classList.remove('mobile-runtime');
        const modal = ensureActionModal();
        modal.style.display = 'flex';
        const windowElement = modal.querySelector('.window');
        makeInAppWindowInteractive(windowElement);
        const labels = returnPrepackSessionLabelHtml();
        const summary = returnPrepackSessionSummaryHtml();
        activeReturnPrepackSession.scannedPackageKeys = [];
        modal.querySelector('#action-modal-body').innerHTML = \`
            <input name="returnPrepackCode">
            <select name="returnMemberFilter"><option value=""></option></select>
            <input name="returnFromDate" type="date">
            <input name="returnToDate" type="date">
            <select name="returnPackageStatus"><option value="all">All</option></select>
            <select name="returnDoseStatus"><option value="all">All</option></select>
            <select name="handling"><option value="return">Return</option></select>
            <span id="return-prepack-filter-count"></span><span id="return-prepack-scan-count"></span>
            <div id="return-prepack-scan-status"></div><div id="return-prepack-pending-summary"></div>
            <details class="return-prepack-group" data-return-key="package-a" data-date="2026-11-19" data-prepack-codes="TESTPKGA" data-package-status="complete" data-stock-mode="stock" data-return-category="unadministered"><summary><input class="return-prepack-package-check" type="checkbox"></summary><label class="return-prepack-row"><input name="returnRows" type="checkbox" value="0"></label></details>
            <details class="return-prepack-group" data-return-key="package-b" data-date="2026-11-20" data-prepack-codes="TESTPKGB" data-package-status="complete" data-stock-mode="stock" data-return-category="unadministered"><summary><input class="return-prepack-package-check" type="checkbox"></summary><label class="return-prepack-row"><input name="returnRows" type="checkbox" value="1"></label></details>\`;
        const scanInput = modal.querySelector('[name="returnPrepackCode"]');
        scanInput.value = 'TESTPKGA'; selectReturnPrepackByCode();
        scanInput.value = 'TESTPKGB'; selectReturnPrepackByCode();
        const beforeMove = windowElement.getBoundingClientRect();
        const titleBar = windowElement.querySelector(':scope > .title-bar');
        titleBar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: beforeMove.left + 80, clientY: beforeMove.top + 10 }));
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: beforeMove.left + 120, clientY: beforeMove.top + 35 }));
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: beforeMove.left + 120, clientY: beforeMove.top + 35 }));
        const afterMove = windowElement.getBoundingClientRect();
        const beforeResize = { width: afterMove.width, height: afterMove.height };
        const resizeHandle = windowElement.querySelector('.window-resize-se');
        resizeHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: afterMove.right, clientY: afterMove.bottom }));
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: afterMove.right + 35, clientY: afterMove.bottom + 30 }));
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: afterMove.right + 35, clientY: afterMove.bottom + 30 }));
        const afterResize = windowElement.getBoundingClientRect();
        return {
            oneAggregatedLabel: (labels.match(/<div class="[^"]*inventory-return-label">/g) || []).length === 1,
            totalQuantity: labels.includes('Qty returned:</b> 3'),
            crossMemberAudit: summary.includes('2 packages') && summary.includes('2 members'),
            multiScanRetained: modal.querySelectorAll('input[name="returnRows"]:checked').length === 2 && activeReturnPrepackSession.scannedPackageKeys.length === 2,
            resizeHandles: windowElement.querySelectorAll('.window-resize-handle').length,
            draggableTitle: getComputedStyle(titleBar).cursor === 'move',
            movedByTitleBar: Math.abs(afterMove.left - beforeMove.left) >= 20 && Math.abs(afterMove.top - beforeMove.top) >= 10,
            resizedFromCorner: afterResize.width > beforeResize.width && afterResize.height > beforeResize.height
        };
    })()`);
    console.log(JSON.stringify(result, null, 2));
    const failed = !result.oneAggregatedLabel || !result.totalQuantity || !result.crossMemberAudit || !result.multiScanRetained || result.resizeHandles !== 8 || !result.draggableTitle || !result.movedByTitleBar || !result.resizedFromCorner;
    win.destroy();
    app.exit(failed ? 1 : 0);
}).catch(error => {
    console.error(error);
    app.exit(1);
});
