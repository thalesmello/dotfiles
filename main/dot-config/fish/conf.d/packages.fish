if not status --is-interactive
    return
end

fundle plugin brgmnn/fish-docker-compose
fundle plugin fischerling/plugin-wd
fundle plugin thalesmello/theme-cmorrell.com
fundle plugin ankitsumitg/docker-fish-completions
fundle plugin lgathy/google-cloud-sdk-fish-completion
# fundle plugin franciscolourenco/done
fundle plugin PatrickF1/colored_man_pages.fish

if status --is-interactive; or set -q IS_FIFC_COMPLETION
    set -gx FIFC_KEYBINDING shift-tab
    set -gx FIFC_EDITOR lvim

    fundle plugin thalesmello/fifc
end

set -q __fundle_plugin_names && fundle init
