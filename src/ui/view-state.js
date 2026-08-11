/** @file Owns schema-driven query-parameter reading, validation, URL building, and history replacement for page controllers. */

(function () {
  function resolvedDefault(definition, state) {
    return typeof definition.default === "function"
      ? definition.default(state)
      : definition.default;
  }

  function schemaParam(key, definition) {
    return String(definition.param || key);
  }

  /**
   * Creates a query-backed page view-state reader and URL builder.
   * @param {{path:string, schema:Record<string, Object>, preserveUnknown?:boolean}} options View path and parameter schema.
   * @returns {{read:(search?:string) => Object, build:(current:Object, overrides?:Object) => string, replace:(current:Object, overrides?:Object) => string}} View-state operations.
   */
  window.createPageViewState = function (options = {}) {
    let schema = options.schema || {};
    let entries = Object.entries(schema);

    function read(search = window.location?.search || "") {
      let params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
      let state = {};
      entries.forEach(([key, definition]) => {
        let value;
        if (definition.read) value = definition.read(params, state);
        else {
          let raw = params.get(schemaParam(key, definition));
          if (raw == null) {
            for (let alias of definition.aliases || []) {
              raw = params.get(alias);
              if (raw != null) break;
            }
          }
          value =
            raw == null
              ? resolvedDefault(definition, state)
              : definition.parse
                ? definition.parse(raw, state)
                : raw;
        }
        if (definition.validate && !definition.validate(value, state))
          value = resolvedDefault(definition, state);
        state[key] = value;
      });
      return state;
    }

    function build(current = {}, overrides = {}) {
      let state = Object.assign({}, current, overrides);
      let params = new URLSearchParams(
        options.preserveUnknown
          ? String(window.location?.search || "").replace(/^\?/, "")
          : "",
      );
      entries.forEach(([key, definition]) => {
        let param = schemaParam(key, definition);
        params.delete(param);
        (definition.aliases || []).forEach((alias) => params.delete(alias));
        (definition.clear || []).forEach((name) => params.delete(name));
        let value = state[key];
        if (definition.write) {
          definition.write(params, value, state);
          return;
        }
        let defaultValue = resolvedDefault(definition, state);
        let omit = definition.omit
          ? definition.omit(value, state)
          : value == null || value === "" || value === defaultValue;
        if (omit) return;
        let serialized = definition.serialize
          ? definition.serialize(value, state)
          : String(value);
        if (serialized != null && serialized !== "")
          params.set(param, serialized);
      });
      let query = params.toString();
      return `${options.path || window.location?.pathname || ""}${query ? `?${query}` : ""}`;
    }

    function replace(current, overrides = {}) {
      let href = build(current, overrides);
      if (window.history?.replaceState)
        window.history.replaceState(null, "", href);
      return href;
    }

    return { read, build, replace };
  };
})();
