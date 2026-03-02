console.log("Users frontend javascript file");

$(function () {
  // Update status
  $(".member-status").on("change", function (e) {
    const id = e.target.id;
    const memberStatus = $(this).val();

    axios
      .post("/admin/user/edit", {
        _id: id,
        memberStatus: memberStatus,
      })
      .then((response) => {
        const result = response.data;
        if (result.data) {
          $(".member-status").blur();
        } else alert("User Update Failed!");
      })
      .catch((err) => {
        console.log("error:", err);
        alert("User update failed!");
      });
  });

  // Search & filter
  function filterUsers() {
    const term = $("#user-search").val().toLowerCase();
    const statusFilter = $("#user-status-filter").val();
    let visible = 0;

    $(".user-row").each(function () {
      const name = $(this).data("name");
      const status = $(this).data("status");

      const matchName = name.includes(term);
      const matchStatus = !statusFilter || status === statusFilter;

      if (matchName && matchStatus) {
        $(this).show();
        visible++;
      } else {
        $(this).hide();
      }
    });

    // Update row numbering
    let idx = 1;
    $(".user-row:visible").each(function () {
      $(this).find("td:first").text(idx++);
    });

    if (visible === 0) $("#users-no-results").show();
    else $("#users-no-results").hide();
  }

  $("#user-search").on("keyup", filterUsers);
  $("#user-status-filter").on("change", filterUsers);
  $("#user-clear-filters").on("click", function () {
    $("#user-search").val("");
    $("#user-status-filter").val("");
    filterUsers();
  });
});
