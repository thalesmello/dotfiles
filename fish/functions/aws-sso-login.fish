function aws-sso-login --argument profile
    true
    and set -Ux AWS_PROFILE $profile
    and aws sso login
end

complete -c aws-sso-login -n '__fish_is_first_token' -xa '(complete -C "aws sso login --profile ")'
