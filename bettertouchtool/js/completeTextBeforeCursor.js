
async function user_complete__save_old_clipboard() {
    let old_clipboard = await get_clipboard_content({format: "NSPasteboardTypeString"});
    await set_string_variable({variable_name: 'user_complete__old_clipboard', to: old_clipboard});
    return JSON.stringify({old_clipboard})
}

async function user_complete__save_start_selection () {
    let start_selection = await get_selection({format: "NSPasteboardTypeString"});
    await set_string_variable({variable_name: 'user_complete__start_selection', to: start_selection});

    return JSON.stringify({start_selection})
}

async function user_complete__save_after_selection () {
    let after_selection = await get_selection({format: "NSPasteboardTypeString"});
    await set_string_variable({variable_name: 'user_complete__after_selection', to: after_selection});

    return JSON.stringify({after_selection})
}

async function user_complete__save_candidate_selection () {
    let candidate = await get_selection({format: "NSPasteboardTypeString"});
    candidate = candidate.slice(0, candidate.length - 1)
    await set_string_variable({variable_name: 'user_complete__candidate', to: candidate});

    return JSON.stringify({candidate})
}

async function user_complete__save_right_selection () {
    let right_selection = await get_selection({format: "NSPasteboardTypeString"});
    await set_string_variable({variable_name: 'user_complete__right_selection', to: right_selection});

    return JSON.stringify({right_selection})
}

async function user_complete__save_is_right_selection_space () {
    let right_selection = await get_string_variable({variable_name: 'user_complete__right_selection'});
    let is_right_selection_space = right_selection === " " ? 1 : 0

    await set_number_variable({variable_name: "user_complete__is_right_selection_space", to: is_right_selection_space})

    return JSON.stringify({is_right_selection_space})
}

async function user_complete__is_valid_candidate () {
    let candidate = await get_string_variable({variable_name: 'user_complete__candidate'});
    let right_selection = await get_string_variable({variable_name: 'user_complete__right_selection'});

    return candidate[candidate.length - 1] === right_selection
}

async function user_complete__is_start_after_selections_equal () {
    let start_selection = await get_string_variable({variable_name: 'user_complete__start_selection'});
    let after_selection = await get_string_variable({variable_name: 'user_complete__after_selection'});

    return start_selection === after_selection
}
