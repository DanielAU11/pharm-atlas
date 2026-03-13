let db = { family: [], inventory: [], schedules: [], history: [], recipes: [] };
let currentEditingMedId = null;
let currentEditingMemberId = null;

window.addEventListener('DOMContentLoaded', async () => {
    const loadedData = await window.api.load();
    // Merge loaded data with our default structure to ensure recipes: [] exists
    db = { ...db, ...loadedData }; 
    if (!db.recipes) db.recipes = []; 
    renderAll();
});

// Helper: Convert file to Base64 for saving
const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
});

window.switchTab = function(tabName) {
    const tabs = ['dashboard', 'schedules', 'inventory', 'family', 'druginfo', 'compounding'];
    tabs.forEach(t => {
        const tabElement = document.getElementById(`tab-${t}`);
        const panelElement = document.getElementById(`panel-${t}`);
        if (t === tabName) {
            tabElement.classList.add('active');
            panelElement.style.display = 'block';
        } else {
            tabElement.classList.remove('active');
            panelElement.style.display = 'none';
        }
    });
};

async function sync() {
    await window.api.save(db);
    renderAll();
}

// --- FAMILY ---
window.removeMember = async function(id) {
    if (confirm("Are you sure you want to remove this person?")) {
        db.family = db.family.filter(m => m.id !== id);
        db.schedules = db.schedules.filter(s => s.memberId !== id);
        await sync();
    }
};

window.openMemberModal = function(id = null) {
    currentEditingMemberId = id;
    const modal = document.getElementById('member-modal');
    const title = document.getElementById('member-modal-title');
    
    // Helper function to set value only if element exists
    const safeSet = (elId, value) => {
        const el = document.getElementById(elId);
        if (el) {
            el.value = value || '';
        } else {
            console.warn(`Missing HTML ID: ${elId}`);
        }
    };

    // 1. Clear all fields safely
    const fields = ['m-first', 'm-middle', 'm-last', 'm-age', 'm-dob', 'm-providers', 'm-diag', 'm-addr', 'm-phone', 'm-email', 'm-meds'];
    fields.forEach(f => safeSet(f, ''));
    
    const activeMedsContainer = document.getElementById('member-active-meds-list');
    if (activeMedsContainer) activeMedsContainer.innerHTML = '';

    if (id) {
        const m = db.family.find(member => member.id === id);
        if (m) {
            if (title) title.innerText = `Edit: ${m.firstName} ${m.lastName}`;
            
            // 2. Fill fields safely
            safeSet('m-first', m.firstName);
            safeSet('m-middle', m.middleName);
            safeSet('m-last', m.lastName);
            safeSet('m-sex', m.sex || 'Male');
            safeSet('m-age', m.age);
            safeSet('m-dob', m.dob);
            safeSet('m-providers', m.providers);
            safeSet('m-diag', m.diagnoses);
            safeSet('m-addr', m.address);
            safeSet('m-phone', m.phone);
            safeSet('m-email', m.email);
            safeSet('m-meds', m.prescribedMeds);

            // 3. Populate Active Meds
            const memberSchedules = db.schedules.filter(s => s.memberId === id);
            memberSchedules.forEach(s => {
                const med = db.inventory.find(inv => inv.id === s.medId);
                const div = document.createElement('div');
                div.className = 'sunken-panel';
                div.style.cssText = "padding:5px; margin-bottom:5px; cursor:pointer; background:white; border:1px inset gray;";
                div.innerHTML = `
                    <strong>${med ? med.name : 'Unknown'} ${med ? med.strength : ''}${med ? med.units : ''}</strong> - ${s.doseQty} ${med ? med.formulation : ''}<br>
                    <small>${s.freq} | ${s.times.join(', ')}</small>
                    <div style="text-align:right; margin-top:5px;">
                        <button onclick="event.stopPropagation(); administerDose('${s.medId}','${s.id}')">💊 Administer</button>
                        <button onclick="event.stopPropagation(); deleteSchedule('${s.id}')">Discontinue</button>
                    </div>
                `;
                div.onclick = () => window.openOrderModifier(s.id);
                if (activeMedsContainer) activeMedsContainer.appendChild(div);
            });
        }
    } else {
        if (title) title.innerText = "Add New Member";
    }
    
    if (modal) modal.style.display = 'flex';
};


window.openOrderModifier = function(scheduleId) {
    const sched = db.schedules.find(s => s.id === scheduleId);
    const med = db.inventory.find(m => m.id === sched.medId);
    
    document.getElementById('mod-sched-id').value = scheduleId;
    document.getElementById('mod-title').innerText = `Modify Order: ${med.name}`;
    document.getElementById('mod-start').value = sched.startDate;
    document.getElementById('mod-end').value = sched.endDate === "Ongoing" ? '' : sched.endDate;
    document.getElementById('mod-freq').value = sched.freq;
    document.getElementById('mod-instr').value = sched.instructions || "";
    
    document.getElementById('order-modifier-modal').style.display = 'flex';
};

window.saveOrderModification = async function() {
    const id = document.getElementById('mod-sched-id').value;
    const sched = db.schedules.find(s => s.id === id);
    if (sched) {
        sched.startDate = document.getElementById('mod-start').value;
        sched.endDate = document.getElementById('mod-end').value || "Ongoing";
        sched.freq = document.getElementById('mod-freq').value;
        sched.instructions = document.getElementById('mod-instr').value;
        await sync();
        document.getElementById('order-modifier-modal').style.display = 'none';
        openMemberModal(sched.memberId); // Refresh member profile
    }
};

window.saveMember = async function() {
    const data = {
        firstName: document.getElementById('m-first').value,
        middleName: document.getElementById('m-middle').value,
        lastName: document.getElementById('m-last').value,
        sex: document.getElementById('m-sex').value,
        age: document.getElementById('m-age').value,
        dob: document.getElementById('m-dob').value,
        providers: document.getElementById('m-providers').value,
        diagnoses: document.getElementById('m-diag').value,
        address: document.getElementById('m-addr').value,
        phone: document.getElementById('m-phone').value,
        email: document.getElementById('m-email').value,
        //prescribedMeds: document.getElementById('m-meds').value,
        name: `${document.getElementById('m-first').value} ${document.getElementById('m-last').value}`
    };
    if (!data.firstName || !data.lastName) return alert("First and Last Name required.");
    if (currentEditingMemberId) {
        const index = db.family.findIndex(m => m.id === currentEditingMemberId);
        db.family[index] = { ...db.family[index], ...data };
    } else {
        db.family.push({ id: Date.now().toString(), ...data });
    }
    await sync();
    closeMemberModal();
};

window.closeMemberModal = () => document.getElementById('member-modal').style.display = 'none';

// --- INVENTORY ---
window.addInventory = async function() {
    const name = document.getElementById('med-name').value;
    const strength = document.getElementById('med-strength').value;
    const units = document.getElementById('med-units').value;
    const qty = parseInt(document.getElementById('med-qty').value);
    const formulation = document.getElementById('med-formulation').value;
    const threshold = parseInt(document.getElementById('med-threshold').value) || 5;
    const imageInput = document.getElementById('med-image-input');
    const isLiquid = units.includes('/');
    const expiry = document.getElementById('med-expiry').value;
    if (!name || isNaN(qty)) return alert("Name and Qty required.");

    let imagePath = null;
    if (imageInput.files[0]) {
        try {
            const base64 = await toBase64(imageInput.files[0]);
            const fileName = `img_${Date.now()}_${imageInput.files[0].name.replace(/\s/g, '_')}`;
            imagePath = await window.api.saveImage(fileName, base64);
        } catch (e) { console.error(e); }
    }

    db.inventory.push({ 
        id: Date.now().toString(), 
        name, 
        strength, 
        units, 
        formulation, // 'Tablets', 'mL', 'Capsules', etc.
        stock: qty, 
        maxCapacity: qty,
        expiry: expiry,
        isLiquid: document.getElementById('med-formulation').value === 'mL',
        minThreshold: parseInt(document.getElementById('med-threshold').value) || 5,
        imagePath: imagePath 
    });
    
    document.getElementById('med-name').value = '';
    document.getElementById('med-strength').value = '';
    document.getElementById('med-qty').value = '';
    imageInput.value = '';
    await sync();
};

window.takeDose = async function(medId) {
    const med = db.inventory.find(m => m.id === medId);
    if (med && med.stock > 0) {
        med.stock -= 1;
        db.history.unshift({ id: Date.now().toString(), timestamp: new Date().toLocaleString(), medName: med.name, details: "Manual dose" });
        await sync();
    }
};

window.refillMed = async function(medId) {
    const med = db.inventory.find(m => m.id === medId);
    if (med) {
        const amount = prompt(`How many units of ${med.name} are you adding?`, "30");
        const refillAmount = parseInt(amount);
        if (!isNaN(refillAmount) && refillAmount > 0) {
            med.stock += refillAmount;
            db.history.unshift({ id: Date.now().toString(), timestamp: new Date().toLocaleString(), medName: med.name, details: `Refilled +${refillAmount}` });
            await sync();
        }
    }
};

window.deleteMed = async function(id) {
    if(confirm("Delete this medication?")) {
        db.inventory = db.inventory.filter(m => m.id !== id);
        await sync();
    }
};

window.openMedProfile = function(id) {
    currentEditingMedId = id;
    const med = db.inventory.find(m => m.id === id);
    document.getElementById('modal-expiry').value = med.expiry;
    document.getElementById('modal-title').innerText = `${med.name} Profile`;
    document.getElementById('modal-stock').value = med.stock;
    document.getElementById('modal-notes').value = med.notes || "";
    document.getElementById('modal-storage').value = med.storage || "";
    document.getElementById('modal-control-level').value = med.controlLevel || "N/A";
    const imgContainer = document.getElementById('modal-image-container');
    imgContainer.innerHTML = med.imagePath ? `<img src="file://${med.imagePath}" style="max-width:100%; max-height:100%;">` : "No Photo";
    document.getElementById('med-modal').style.display = 'flex';
};

window.saveMedProfile = async function() {
    const med = db.inventory.find(m => m.id === currentEditingMedId);
    if (med) {
        med.stock = parseInt(document.getElementById('modal-stock').value);
        med.notes = document.getElementById('modal-notes').value;
        med.storage = document.getElementById('modal-storage').value;
        med.controlLevel = document.getElementById('modal-control-level').value;
        med.expiry = document.getElementById('modal-expiry').value;
        await sync();
        closeMedModal();
    }
};

window.closeMedModal = () => document.getElementById('med-modal').style.display = 'none';

// --- SCHEDULING ---
window.updateSchedStrength = function() {
    const input = document.getElementById('med-search-input');
    const name = input.value;
    
    // Find all inventory items that have this exact name
    const matches = db.inventory.filter(m => m.name === name);
    
    const strengthSelect = document.getElementById('sched-strength-display');
    const unitsDisp = document.getElementById('sched-units-display');

    // Clear the dropdown first
    strengthSelect.innerHTML = '';

    if (matches.length > 0) {
        matches.forEach(med => {
            const opt = document.createElement('option');
            opt.value = med.id; // Store the ID so we know exactly which one was picked
            opt.innerText = med.strength;
            strengthSelect.appendChild(opt);
        });
        
        // Update units display based on the first match
        if (unitsDisp) unitsDisp.innerText = matches[0].units;
        input.style.backgroundColor = "#e0ffe0"; 
    } else {
        if (unitsDisp) unitsDisp.innerText = 'units';
        input.style.backgroundColor = ""; 
    }
};

//Scheduler checks every minute to see if any meds are due and sends a notification
function checkSchedules() {
    const now = new Date();
    // Force HH:MM format (e.g., "08:30")
    const currentHours = now.getHours().toString().padStart(2, '0');
    const currentMinutes = now.getMinutes().toString().padStart(2, '0');
    const currentTime = `${currentHours}:${currentMinutes}`;
    
    console.log("Checking schedules for time:", currentTime); // Debugging line

    db.schedules.forEach(s => {
        // Only notify if the time matches EXACTLY
        if (s.times.includes(currentTime)) {
            const med = db.inventory.find(m => m.id === s.medId);
            const member = db.family.find(f => f.id === s.memberId);
            
            if (med && member) {
                console.log("Match found! Sending notification for:", med.name);
                window.api.notify(
                    "Medication Due!", 
                    `${member.firstName} needs ${s.doseQty} ${med.formulation} of ${med.name}${med.strength ? ` (${med.strength}${med.units})` : ''} now!`
                );
            }
        }
    });
}
setInterval(checkSchedules, 60 * 1000); // Check every minute
checkSchedules(); // Initial check on load  

window.toggleQODDate = function() {
    const freq = document.getElementById('sched-freq').value;
    document.getElementById('qod-start-container').style.display = (freq === 'QOD') ? 'block' : 'none';
};

window.addSchedule = async function() {
    const memberId = document.getElementById('select-member').value;
    const medId = document.getElementById('sched-strength-display').value;
    const med = db.inventory.find(m => m.id === medId);
    
    const startDate = document.getElementById('sched-start').value;
    const endDate = document.getElementById('sched-end').value || "Ongoing";
    
    const instructions = document.getElementById('sched-instructions').value;

    if (!med || !startDate) return alert("Select medication name, strength, and start date!");

    const times = [];
    if (document.getElementById('sched-time-manual').value) times.push(document.getElementById('sched-time-manual').value);
    if (document.getElementById('chk-am').checked) times.push("08:00");
    if (document.getElementById('chk-noon').checked) times.push("12:00");
    if (document.getElementById('chk-pm').checked) times.push("20:00");

    db.schedules.push({
        id: Date.now().toString(), 
        memberId, 
        medId: med.id,
        doseQty: document.getElementById('sched-dose-qty').value,
        freq: document.getElementById('sched-freq').value,
        startDate,
        endDate,
        instructions: instructions,
        qodStart: document.getElementById('qod-start-date').value,
        times,
        isOneTime: (startDate === endDate && endDate !== "Ongoing")
    });
    
    await sync();
    
    // Clear fields
    document.getElementById('med-search-input').value = '';
    document.getElementById('sched-instructions').value = '';
    document.getElementById('sched-strength-display').innerHTML = '';
};


window.administerDose = async function(medId, scheduleId) {
    const med = db.inventory.find(m => m.id === medId);
    const sched = db.schedules.find(s => s.id === scheduleId);
    
    // doseQty is the number of units (e.g., 2 tablets or 10 mL)
    const qtyToSubtract = parseFloat(sched.doseQty) || 0;

    if (med && med.stock >= qtyToSubtract) {
        med.stock -= qtyToSubtract;
        
        // As a pharmacist, you'll appreciate the detailed log:
        const logDetail = med.isLiquid ? `${qtyToSubtract} mL` : `${qtyToSubtract} ${med.formulation}`;
        
        db.history.unshift({ 
            id: Date.now().toString(), 
            timestamp: new Date().toLocaleString(), 
            medName: med.name, 
            details: `Administered ${logDetail} via Schedule` 
        });
        if (sched.isOneTime) {
            db.schedules = db.schedules.filter(s => s.id !== scheduleId);
        }
        await sync();
    } else { 
        alert(`Insufficient stock! You need ${qtyToSubtract}, but only have ${med ? med.stock : 0} left.`); 
    }
};


window.deleteSchedule = async function(id) {
    db.schedules = db.schedules.filter(s => s.id !== id);
    await sync();
};

window.saveRecipe = async function() {
    const name = document.getElementById('recipe-name').value;
    const drugId = document.getElementById('recipe-drug-select').value;
    const targetConc = parseFloat(document.getElementById('recipe-target-conc').value);
    const totalVol = parseFloat(document.getElementById('recipe-total-vol').value);
    
    const drug = db.inventory.find(m => m.id === drugId);
    const drugVolNeeded = (targetConc * totalVol) / drug.strength;
    const diluentNeeded = totalVol - drugVolNeeded;

    const recipe = {
        id: Date.now().toString(),
        name: name,
        ingredients: [
            { id: drug.id, name: drug.name, amount: drugVolNeeded, unit: 'mL' },
            { name: 'Diluent/Water', amount: diluentNeeded, unit: 'mL' }
        ],
        totalVol: totalVol
    };

    db.recipes.push(recipe);
    
    // Add to inventory with 0 stock
    db.inventory.push({
        id: 'comp_' + recipe.id,
        name: name,
        strength: targetConc,
        units: 'mg/mL',
        formulation: 'mL',
        stock: 0,
        isLiquid: true
    });

    await sync();
    alert("Recipe saved to Master Formulary!");
};

window.prepareCompoundBatch = function() {
    const recipeId = document.getElementById('prepare-select').value;
    const multiplier = parseFloat(document.getElementById('prepare-multiplier').value) || 1;
    const recipe = db.recipes.find(r => r.id === recipeId);
    
    const container = document.getElementById('prep-checklist');
    container.innerHTML = `<h4>Batch Size: ${recipe.totalVol * multiplier} mL</h4>`;
    
    recipe.ingredients.forEach(ing => {
        const row = document.createElement('div');
        row.className = 'field-row';
        row.innerHTML = `
            <input type="checkbox" onchange="this.parentElement.style.background = this.checked ? '#e0ffe0' : ''">
            <label>${ing.name}: ${(ing.amount * multiplier).toFixed(2)} ${ing.unit}</label>
        `;
        container.appendChild(row);
    });
    
    document.getElementById('prep-modal').style.display = 'flex';
};

window.finishBatch = async function() {
    const recipeId = document.getElementById('prepare-select').value;
    const multiplier = parseFloat(document.getElementById('prepare-multiplier').value) || 1;
    const recipe = db.recipes.find(r => r.id === recipeId);
    
    const invItem = db.inventory.find(i => i.id === 'comp_' + recipe.id);
    invItem.stock += (recipe.totalVol * multiplier);
    
    await sync();
    document.getElementById('prep-modal').style.display = 'none';
};



// --- RENDERING ---
// Helper to parse "YYYY-MM-DD" as a local date (avoiding UTC shift)
function parseLocal(dateStr) {
    if (!dateStr || dateStr === "Ongoing") return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day); // month is 0-indexed
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize today to local midnight

    // 1. Render Headers
    for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        grid.innerHTML += `
            <div style="background:#c0c0c0; border:1px outset white; text-align:center; font-size:10px; font-weight:bold; padding:2px;">
                ${days[d.getDay()]}<br>${d.getMonth()+1}/${d.getDate()}
            </div>`;
    }

    // 2. Render Day Cells
    for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        
        // Create a comparison string "YYYY-MM-DD" for the current cell
        const y = d.getFullYear();
        const m = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        const dateStr = `${y}-${m}-${day}`;

        const cell = document.createElement('div');
        cell.style.cssText = "background:white; border:1px inset gray; min-height:80px; padding:2px; font-size:9px; overflow-y:auto;";

        const todaysMeds = [];
        db.schedules.forEach(s => {
            const isAfterStart = dateStr >= s.startDate;
            const isBeforeEnd = s.endDate === "Ongoing" || dateStr <= s.endDate;
    
            let isDueToday = isAfterStart && isBeforeEnd;
            if (isDueToday && s.freq === 'QOD' && s.qodStart) {
                const currentD = parseLocal(dateStr);
                const startD = parseLocal(s.qodStart);
                const diff = Math.floor((currentD - startD) / (1000 * 60 * 60 * 24));
                isDueToday = (diff >= 0 && diff % 2 === 0);
            }

            if (isDueToday) {
            // Create an entry for EACH time assigned to this schedule
                s.times.forEach(time => {
                    todaysMeds.push({ ...s, specificTime: time });
                });
         }
    });
        todaysMeds.sort((a, b) => a.specificTime.localeCompare(b.specificTime));

        todaysMeds.forEach(s => {
            const med = db.inventory.find(m => m.id === s.medId);
            const mem = db.family.find(f => f.id === s.memberId);
            if (med && mem) {
                cell.innerHTML += `
                    <div style="border-bottom:1px dotted #808080; padding: 1px 0; color: #000;"; cursor: pointer;" onclick="openOrderModifier('${mem.id}')">
                        <i style="color: blue;">${s.specificTime}</i> - <b>${mem.firstName}</b>: ${med.name} ${med.strength}${med.units}
                         
                    </div>`;  
            }
        });
        
        grid.appendChild(cell);
    }
}


function renderAll() {
    const recipeSelect = document.getElementById('prepare-select');
    const drugSelect = document.getElementById('recipe-drug-select');

    if(recipeSelect) recipeSelect.innerHTML = db.recipes.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    if(drugSelect) drugSelect.innerHTML = db.inventory.filter(i => i.isLiquid).map(i => `<option value="${i.id}">${i.name} (${i.strength}${i.units})</option>`).join('');

    const familyList = document.getElementById('family-list');
    const memberSelect = document.getElementById('select-member');
    if (familyList && memberSelect) {
        familyList.innerHTML = ''; memberSelect.innerHTML = '';
        db.family.forEach(m => {
            const color = m.sex === "Female" ? "pink" : "lightblue";
            familyList.innerHTML += `<li class="med-item-row" style="background:${color}; margin-bottom:2px; border:1px inset white;">
                <span style="cursor:pointer; font-weight:bold;" onclick="openMemberModal('${m.id}')">👤 ${m.lastName}, ${m.firstName}</span>
                <button onclick="removeMember('${m.id}')">Remove</button></li>`;
            memberSelect.innerHTML += `<option value="${m.id}">${m.lastName}, ${m.firstName}</option>`;
        });
    }

    const tableBody = document.getElementById('inventory-table-body');
    const medDataList = document.getElementById('med-options');
    if (tableBody) tableBody.innerHTML = '';
    if (medDataList) medDataList.innerHTML = '';
db.inventory.forEach(med => {
    if (tableBody) {
        const row = document.createElement('tr');

        // --- EXPIRATION LOGIC ---
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const tenDaysFromNow = new Date();
        tenDaysFromNow.setDate(today.getDate() + 10);
        
        // Parse the med's expiry date
        const expiryDate = med.expiry ? new Date(med.expiry) : null;
        
        const isLowStock = med.stock <= med.minThreshold;
        const isExpiringSoon = expiryDate && expiryDate <= tenDaysFromNow;
        const isExpired = expiryDate && expiryDate < today;

        // Turn row red if low stock OR expiring within 10 days
        if (isLowStock || isExpiringSoon || isExpired) {
            row.style.color = "red";
            row.style.fontWeight = "bold";
        }

        row.innerHTML = `
            <td style="display:flex; align-items:center; gap:5px;">
                ${med.imagePath ? `<img src="file://${med.imagePath}" style="width:20px; height:20px; object-fit:cover;">` : '💊'}
                <span style="cursor:pointer; text-decoration:underline;" onclick="openMedProfile('${med.id}')">${med.name}</span>
            </td>
            <td>${med.strength}</td>
            <td>${med.units}</td>
            <td>${med.stock}</td>
            <td>${med.minThreshold}</td>
            <td>${med.expiry || 'N/A'}</td> <!-- NEW EXPIRATION COLUMN -->
            <td>
                <button onclick="takeDose('${med.id}')">Take</button>
                <button onclick="refillMed('${med.id}')">Refill</button>
                <button onclick="deleteMed('${med.id}')">Delete</button>
            </td>`;
        tableBody.appendChild(row);
    }
    
    if (medDataList) {
        const opt = document.createElement('option');
        opt.value = med.name;
        opt.innerText = `${med.strength} ${med.units}`;
        medDataList.appendChild(opt);
    }
});


    const historyDiv = document.getElementById('history-log');
    if (historyDiv) {
        historyDiv.innerHTML = db.history.map(e => `<div style="font-size:11px; border-bottom:1px dotted #ccc;">[${e.timestamp}] ${e.medName}: ${e.details}</div>`).join('');
    }

    const schedList = document.getElementById('schedule-list');
    if (schedList) {
        schedList.innerHTML = '';
        db.schedules.forEach(s => {
            const p = db.family.find(f => f.id === s.memberId);
            const m = db.inventory.find(i => i.id === s.medId);
            schedList.innerHTML += `<div class="med-item-row" style="padding:5px; border-bottom:1px solid #808080;">
                <div style="flex-grow:1;"><b>${p?p.firstName:'?'}</b> - ${m?m.name:'?'} ${m?m.strength:'?'} ${m?m.units:'?'} (${s.times.join(', ')})</div>
                <button onclick="administerDose('${s.medId}','${s.id}')">💊 Admin</button>
                <button onclick="deleteSchedule('${s.id}')">Discontinue</button></div>`;
        });
    }
    renderCalendar();
}
window.calculateLiveDose = function() {
    const medId = document.getElementById('sched-strength-display').value;
    const qty = parseFloat(document.getElementById('sched-dose-qty').value) || 0;
    const calcDisplay = document.getElementById('sched-calculated-dose');
    const unitsLabel = document.getElementById('sched-units-display');
    
    const med = db.inventory.find(m => m.id === medId);
    if (!med) return;

    unitsLabel.innerText = med.formulation;

    let totalDose = 0;
    let doseUnit = "";

    if (med.isLiquid) {
        // Example: 100mg/5mL -> concentration is 20mg per 1mL
        // User enters 10 in "Give Qty" (mL)
        // Dose = 10 * 20 = 200mg
        const parts = med.units.split('/'); // ["mg", "mL"]
        const conc = med.strength; // We assume user entered the concentration (e.g. 20)
        totalDose = qty * conc;
        doseUnit = parts[0];
    } else {
        // Example: 500mg Tablet. User enters 2 in "Give Qty".
        // Dose = 2 * 500 = 1000mg
        totalDose = qty * med.strength;
        doseUnit = med.units;
    }

    calcDisplay.value = `${totalDose} ${doseUnit}`;
};


window.clearHistory = async function() {
    if (confirm("Clear history?")) { db.history = []; await sync(); }
};

window.addEventListener('DOMContentLoaded', async () => {
    db = await window.api.load();
    renderAll();
});
