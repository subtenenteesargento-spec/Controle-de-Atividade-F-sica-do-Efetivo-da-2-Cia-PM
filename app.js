(function () {
  "use strict";

  function signatureRecord(row) {
    const value = row && row.activity_signatures;
    if (!value) return null;
    if (Array.isArray(value)) return value[0] || null;
    return value;
  }

  window.fixActivitySignature = {
    signatureRecord
  };
})();
