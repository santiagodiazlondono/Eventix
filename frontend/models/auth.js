(function () {
  "use strict";

  var hostname = window.location.hostname || "localhost";
  var apiBase = window.EVENTIX_API_URL ||
    (window.Eventix && window.Eventix.apiBase) ||
    window.location.protocol + "//" + hostname + ":5000/api";

  async function request(path, options) {
    var config = Object.assign({
      credentials: "include",
      headers: { Accept: "application/json" }
    }, options || {});
    config.headers = Object.assign(
      { Accept: "application/json" },
      options && options.headers ? options.headers : {}
    );
    var response = await fetch(apiBase + path, config);
    if (response.status === 204) return null;

    var result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error("El servidor devolvió una respuesta no válida.");
    }
    if (!response.ok) {
      var apiError = new Error(result.error || "No fue posible completar la solicitud.");
      apiError.status = response.status;
      throw apiError;
    }
    return result;
  }

  function roleHome(role) {
    return {
      cliente: "catalogo.html",
      agente: "agente-registro.html",
      administrador: "admin-panel.html"
    }[role] || "Login.html";
  }

  function showUser(user) {
    var fullName = [user.nombres, user.apellidos].filter(Boolean).join(" ");
    document.querySelectorAll(".js-user-name").forEach(function (element) {
      element.textContent = fullName || user.correo_electronico;
    });
    var initials = fullName
      .split(/\s+/)
      .slice(0, 2)
      .map(function (part) { return part.charAt(0); })
      .join("")
      .toUpperCase() || "U";
    document.querySelectorAll(".js-user-avatar, .avatar-superior, .admin-avatar-text").forEach(function (element) {
      element.textContent = initials;
    });
    document.querySelectorAll(".admin-user-badge").forEach(function (badge) {
      var name = Array.prototype.slice.call(badge.children).find(function (child) {
        return !child.classList.contains("brand-mark");
      });
      if (name) name.textContent = fullName || user.correo_electronico;
    });
    document.querySelectorAll(".js-user-initials").forEach(function (element) {
      element.textContent = fullName
        .split(/\s+/)
        .slice(0, 2)
        .map(function (part) { return part.charAt(0); })
        .join("")
        .toUpperCase() || "U";
    });
  }

  async function requireRole(role) {
    var result;
    try {
      result = await request("/auth/me");
    } catch (error) {
      if (error.status === 401) {
        window.location.replace("Login.html");
        return null;
      }
      throw error;
    }

    if (!result.usuario || result.usuario.role !== role) {
      window.location.replace(roleHome(result.usuario && result.usuario.role));
      return null;
    }
    showUser(result.usuario);
    return result.usuario;
  }

  async function logout() {
    await request("/auth/logout", { method: "POST" });
    window.location.replace("Login.html");
  }

  window.EventixAuth = {
    apiBase: apiBase,
    request: request,
    login: function (correo, contrasena) {
      return request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo: correo, contrasena: contrasena })
      });
    },
    register: function (data) {
      return request("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
    },
    getCurrentUser: function () {
      return request("/auth/me");
    },
    logout: logout,
    requireRole: requireRole,
    roleHome: roleHome,
    showUser: showUser
  };
})();
