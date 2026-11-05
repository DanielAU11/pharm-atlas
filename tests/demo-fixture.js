window.installPharmAtlasDemoFixture = function() {
    const today = localDateKey();
    const start = addDaysKey(today, -14);
    const end = addDaysKey(today, 45);
    const tomorrow = addDaysKey(today, 1);
    const memberId = 'demo-member';
    const meds = [
        { id: 'med-lisinopril', name: 'Lisinopril', strength: 10, units: 'mg', formulation: 'Tablets', administrationUnit: 'tablet', inventoryUnit: 'tablet', stock: 54, minThreshold: 14, expiry: addDaysKey(today, 300), assignedMemberIds: [memberId], barcodeCode: 'PA-DEMO-LIS-10' },
        { id: 'med-metformin', name: 'Metformin ER', strength: 500, units: 'mg', formulation: 'Tablets', administrationUnit: 'tablet', inventoryUnit: 'tablet', stock: 76, minThreshold: 20, expiry: addDaysKey(today, 250), assignedMemberIds: [memberId], barcodeCode: 'PA-DEMO-MET-500' },
        { id: 'med-vitd', name: 'Vitamin D3', strength: 2000, units: 'IU', formulation: 'Capsules', administrationUnit: 'capsule', inventoryUnit: 'capsule', stock: 22, minThreshold: 10, expiry: addDaysKey(today, 420), assignedMemberIds: [memberId], barcodeCode: 'PA-DEMO-D3-2000' },
        { id: 'med-apap', name: 'Acetaminophen', strength: 325, units: 'mg', formulation: 'Tablets', administrationUnit: 'tablet', inventoryUnit: 'tablet', stock: 90, minThreshold: 24, expiry: addDaysKey(today, 500), assignedMemberIds: [memberId], barcodeCode: 'PA-DEMO-APAP-325' },
        { id: 'med-cream', name: 'Hydrocortisone cream', strength: 1, units: '%', formulation: 'Cream', administrationUnit: 'application', inventoryUnit: 'tube', stock: 2, minThreshold: 1, expiry: addDaysKey(today, 180), assignedMemberIds: [memberId], barcodeCode: 'PA-DEMO-HC-1' }
    ];
    const schedule = (id, medId, freq, times, extra = {}) => ({
        id, memberId, medId, doseQty: 1, freq, startDate: start, endDate: 'Ongoing', times,
        startTime: times[0] || '', weekdays: [], status: '', instructions: '', indication: '', ...extra
    });
    const schedules = [
        schedule('sched-lisinopril', 'med-lisinopril', 'QD', ['08:00'], { indication: 'Blood pressure', prescriberId: 'provider-1', linkRules: [{ targetId: 'sched-vitd', mode: 'together' }], linkTargetIds: ['sched-vitd'], linkTargetId: 'sched-vitd', linkMode: 'together' }),
        schedule('sched-vitd', 'med-vitd', 'QD', ['08:00'], { indication: 'Supplement', linkRules: [{ targetId: 'sched-lisinopril', mode: 'together' }], linkTargetIds: ['sched-lisinopril'], linkTargetId: 'sched-lisinopril', linkMode: 'together' }),
        schedule('sched-metformin', 'med-metformin', 'BID', ['08:00', '18:00'], { indication: 'Blood glucose', instructions: 'Take with food', prescriberId: 'provider-1' }),
        schedule('sched-qod', 'med-apap', 'QOD', ['10:00'], { qodStart: start, indication: 'Demonstration every-other-day order', endDate: end }),
        schedule('sched-prn', 'med-apap', 'PRN', [], { doseQty: 2, indication: 'Occasional pain', prnMaxDoses: 3, prnWindowHours: 24 }),
        schedule('sched-custom', 'med-cream', 'CUSTOM', ['07:00', '20:00'], { weekdays: [1, 3, 5], customScheduleSameTimes: true, customTimesByWeekday: { 1: ['07:00', '20:00'], 3: ['07:00', '20:00'], 5: ['07:00', '20:00'] }, indication: 'Skin care' })
    ];
    const givenInstance = getScheduleInstancesForDate(schedules[0], today)[0] || { date: today, time: '08:00' };
    db = {
        ...emptyDb,
        family: [{
            id: memberId, firstName: 'Jordan', lastName: 'Rivera', sex: 'Male', dob: '1988-04-18',
            diagnoses: ['Hypertension', 'Type 2 diabetes'], allergies: ['Penicillin'], providerIds: ['provider-1'], pharmacyIds: ['pharmacy-1'],
            bpGoals: { preset: 'treated', systolicLow: 90, systolicHigh: 130, diastolicLow: 60, diastolicHigh: 80 },
            glucoseGoals: { preset: 'diabetic', low: 80, high: 180 }, monitoringProfiles: []
        }],
        prescribers: [{ id: 'provider-1', name: 'Dr. Avery Morgan', specialty: 'Primary Care', favorite: true, primary: true }],
        pharmacies: [{ id: 'pharmacy-1', name: 'Neighborhood Pharmacy', phone: '(555) 010-2211', favorite: true, primary: true }],
        inventory: meds,
        schedules,
        history: [{
            id: 'history-1', memberId, medId: 'med-lisinopril', scheduleId: 'sched-lisinopril', medName: 'Lisinopril',
            date: givenInstance.date, time: '08:05', scheduledDate: givenInstance.date, scheduledTime: givenInstance.time,
            scheduleInstanceKey: scheduleInstanceKey('sched-lisinopril', givenInstance.date, givenInstance.time), doseStatus: 'given',
            timestamp: `${givenInstance.date} 08:05`, details: 'Administered as scheduled.'
        }],
        vitals: [
            { id: 'vital-1', memberId, type: 'bp', date: today, time: '07:45', systolic: 124, diastolic: 78, hr: 72, notes: 'Morning reading' },
            { id: 'vital-2', memberId, type: 'glucose', date: today, time: '07:50', glucose: 112, notes: 'Before breakfast' },
            { id: 'vital-3', memberId, type: 'weight', date: today, time: '07:40', weight: 168.4, weightUnit: 'lb' }
        ],
        orderSets: [{
            id: 'regimen-1', memberId, name: 'Morning Wellness', startDate: start, endDate: 'Ongoing', favorite: true, status: '',
            items: [
                { rowId: 'row-lis', medId: 'med-lisinopril', doseQty: 1, freq: 'QD', times: ['08:00'], startTime: '08:00', indication: 'Blood pressure' },
                { rowId: 'row-d3', medId: 'med-vitd', doseQty: 1, freq: 'QD', times: ['08:00'], startTime: '08:00', indication: 'Supplement' }
            ]
        }],
        careReminders: [{ id: 'reminder-1', memberId, type: 'bp', title: 'Check blood pressure', startDate: today, endDate: 'Ongoing', freq: 'QD', times: ['07:45'], status: '' }],
        recipes: [{
            id: 'recipe-1', name: 'Simple barrier ointment', finalName: 'Barrier Ointment', dosageForm: 'Ointment',
            yieldQty: 30, yieldUnit: 'g', packageSize: '30 g jar', storage: 'Room temperature', beyondUseDays: 30,
            instructions: 'Apply a thin layer as directed.', notes: 'Mix until uniform.', ingredients: [{ name: 'Petrolatum', qty: 30, unit: 'g' }]
        }],
        customEvents: [{ id: 'event-1', title: 'Medication review', date: tomorrow, time: '14:00', memberIds: [memberId], type: 'appointment', note: 'Bring current medication list.' }],
        prepackQueues: [{
            id: 'queue-1', memberId, memberName: 'Jordan Rivera', title: 'Weekly morning prepack', sourceLabel: `${today} - ${addDaysKey(today, 6)}`,
            selection: { scheduleIds: ['sched-lisinopril', 'sched-vitd', 'sched-metformin'], startDate: today, endDate: addDaysKey(today, 6), labelLayout: 'daily' },
            scheduledFor: `${today}T09:00`, labelsPrinted: true, createdAt: new Date().toISOString(), currentDayIndex: 0, status: 'pending',
            days: [{
                date: today, status: 'pending', needsReprint: false, prepackCode: 'PA-DEMO-PREPACK-1', items: [
                    { id: 'pack-item-1', scheduleId: 'sched-lisinopril', medId: 'med-lisinopril', medName: 'Lisinopril', strength: '10mg', time: '08:00', quantity: '1 tablet', dose: '10mg', status: 'correct', expirationDate: meds[0].expiry, source: 'inventory' },
                    { id: 'pack-item-2', scheduleId: 'sched-vitd', medId: 'med-vitd', medName: 'Vitamin D3', strength: '2000IU', time: '08:00', quantity: '1 capsule', dose: '2000IU', status: '', expirationDate: meds[2].expiry, source: 'inventory' },
                    { id: 'pack-item-3', scheduleId: 'sched-metformin', medId: 'med-metformin', medName: 'Metformin ER', strength: '500mg', time: '08:00', quantity: '1 tablet', dose: '500mg', status: '', expirationDate: meds[1].expiry, source: 'inventory' }
                ]
            }]
        }],
        settings: { dashboardCommandCollapsed: false }
    };
    normalizeScheduleLinkRelationships();
    activePrepackQueueId = 'queue-1';
    renderAll();
    switchTab('dashboard');
    return { today, memberId, inventoryCount: db.inventory.length, scheduleCount: db.schedules.length };
};
