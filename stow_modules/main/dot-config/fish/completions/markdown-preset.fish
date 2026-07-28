complete -c markdown-preset -f

complete -c markdown-preset -n "__fish_is_nth_token 1" -d "Preset" -a "
    is-clipboard-rtf\t'Test if clipboard holds RTF'
    is-clipboard-md\t'Test if clipboard holds markdown'
    stdin-to-md\t'Convert RTF stdin to markdown'
    stdin-to-rtf\t'Convert markdown stdin to RTF'
    clipboard-to-md\t'Convert clipboard rich text to markdown'
    clipboard-to-rtf\t'Convert clipboard markdown to RTF'
    selection-to-md\t'Copy selection and convert to markdown on the clipboard'
    selection-to-rtf\t'Copy selection and convert to RTF on the clipboard'
"
