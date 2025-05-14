// types.ts

declare function runAppleScript(options: { scriptCode: string }): Promise<any>;
declare function runJXA(options: { scriptCode: string }): Promise<any>;
declare function runShellScript(options: { script: string; launchPath?: string; parameters?: string; environmentVariables?: string }): Promise<any>;
declare function runAppleShortcut(options: { name: string; input?: string }): Promise<any>;
declare function 
declare function readFile(options: { path: string; readAsBase64?: boolean }): Promise<string>;
declare function fetchURLAsBase64(options: { url: string; readAsBase64?: boolean }): Promise<string>;
declare function writeStringToFile(options: { dataString: string; path: string; stringIsBase64?: boolean }): Promise<void>;
declare function 
declare function trigger_named(options: { trigger_name: string; wait_for_reply?: boolean }): Promise<any>;
declare function trigger_named_async_without_response(options: { trigger_name: string; delay?: number }): Promise<void>;
declare function cancel_delayed_named_trigger_execution(options: { trigger_name: string }): Promise<void>;
declare function 
declare function update_touch_bar_widget(options: { uuid: string; json: any }): Promise<void>;
declare function update_menubar_item(options: { uuid: string; json: any }): Promise<void>;
declare function update_stream_deck_widget(options: { uuid: string; json: any }): Promise<void>;
declare function 
declare function trigger_action(options: { json: any; wait_for_reply?: boolean }): Promise<any>;
declare function execute_assigned_actions_for_trigger(options: { uuid: string }): Promise<any>;
declare function refresh_widget(options: { uuid: string }): Promise<void>;
declare function 
declare function get_trigger(options: { uuid: string }): Promise<any>;
declare function get_triggers(options: { 
   trigger_type?: string; 
   trigger_id?: number; 
   trigger_parent_uuid?: string; 
   trigger_uuid?: string; 
   trigger_app_bundle_identifier?: string 
 }): Promise<any>;
declare function add_new_trigger(options: { json: any; trigger_parent_uuid?: string }): Promise<void>;
declare function delete_trigger(options: { uuid: string }): Promise<void>;
declare function get_clipboard_content(options: { format?: string; asBase64?: boolean }): Promise<string>;
declare function get_selection(options: { format?: string; asBase64?: boolean }): Promise<string>;
declare function set_persistent_string_variable(options: { variable_name: string; to: string }): Promise<void>;
declare function set_string_variable(options: { variable_name: string; to: string }): Promise<void>;
declare function set_persistent_number_variable(options: { variable_name: string; to: number }): Promise<void>;
declare function set_number_variable(options: { variable_name: string; to: number }): Promise<void>;
declare function get_number_variable(options: { variable_name: string }): Promise<number>;
declare function get_string_variable(options: { variable_name: string }): Promise<string>;
declare function export_preset(options: { 
   name: string; 
   compress?: boolean; 
   includeSettings?: boolean; 
   outputPath?: string; 
   comment?: string; 
   link?: string; 
   minimumVersion?: string 
 }): Promise<void>;
declare function get_preset_details(options: { name: string }): Promise<any>;
declare function display_notification(options: { title: string; subTitle?: string; soundName?: string; imagePath?: string }): Promise<void>;
declare function paste_text(options: { text: string; insert_by_pasting?: boolean; move_cursor_left_by_x_after_pasting?: number; format?: string }): Promise<void>;
declare function reveal_element_in_ui(options: { uuid: string }): Promise<void>;
declare function get_menu_item_details(options: { path: string }): Promise<string>;
declare function set_clipboard_content(options: { content: string; format?: string }): Promise<void>;
declare function set_keychain_item(options: { name: string; secret: string }): Promise<void>;
declare function get_keychain_item(options: { name: string; account?: string }): Promise<string>;
