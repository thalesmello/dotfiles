; extends
(field
  name: (_) @pair.key
  value: (_) @pair.value)


(function_definition
  body: (block) @fundef.inner
  ) @fundef.outer
