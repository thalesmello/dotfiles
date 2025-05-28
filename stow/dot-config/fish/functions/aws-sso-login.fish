function aws-sso-login --argument profile
    true
    and set -Ux AWS_PROFILE $profile

    if not aws --profile "$profile" sts get-caller-identity >/dev/null 2>&1
        aws sso login
    end
end

complete -c aws-sso-login -n '__fish_is_first_token' -xa '(complete -C "aws sso login --profile ")'
