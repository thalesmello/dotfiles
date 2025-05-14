//if you rename this, make sure to also rename it in the "function to call" field below.
async function user_complete__save_old_clipboard() {
    let old_clipboard = await get_clipboard_content({format: "NSPasteboardTypeString"});
    await set_string_variable({variable_name: 'user_complete__old_clipboard', to: old_clipboard});
    return JSON.stringify({old_clipboard})
}

async function user_complate__save_candidate_selection () {
    let candidate = await get_selection({format: "NSPasteboardTypeString"});
    await set_string_variable({variable_name: 'user_complete__candidate', to: candidate});

    return JSON.stringify({candidate})
}

async function user_complate__save_right_selection () {
    let right_selection = await get_selection({format: "NSPasteboardTypeString"});
    await set_string_variable({variable_name: 'user_complete__right_selection', to: right_selection});

    return JSON.stringify({right_selection})
}

async function user_complate__is_valid_candidate () {
    let candidate = await get_string_variable({variable_name: 'user_complete__right_selection'});
    let right_selection = await get_string_variable({variable_name: 'user_complete__right_selection'});

    return right_selection == null || right_selection === ""
}
