function __wm_translate_direction
    switch "$argv[1]"
        case west
            echo left
        case east
            echo right
        case north
            echo up
        case south
            echo down
        case left
            echo left
        case right
            echo right
        case up
            echo up
        case down
            echo down
        case '*'
            echo $argv[1]
    end
end
