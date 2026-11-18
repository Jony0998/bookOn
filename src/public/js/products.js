// Admin: books page (filters, create form, status, edit modal)

$(function () {
  // Book categories don't need conditional display logic anymore
  // Both size and weight fields are always visible for books

  // Search and Filter functionality
  function filterProducts() {
    const searchTerm = $("#search-input").val().toLowerCase();
    const statusFilter = $("#status-filter").val();
    const typeFilter = $("#type-filter").val();
    
    let visibleCount = 0;
    
    $(".product-row").each(function() {
      const name = $(this).data("name");
      const status = $(this).data("status");
      const type = $(this).data("type");
      
      const matchesSearch = name.includes(searchTerm);
      const matchesStatus = !statusFilter || status === statusFilter;
      const matchesType = !typeFilter || type === typeFilter;
      
      if (matchesSearch && matchesStatus && matchesType) {
        $(this).show();
        visibleCount++;
      } else {
        $(this).hide();
      }
    });
    
    // Show/hide no results message
    if (visibleCount === 0) {
      $("#no-results").show();
    } else {
      $("#no-results").hide();
    }
    
    // Update row numbers
    let index = 1;
    $(".product-row:visible").each(function() {
      $(this).find("td:first").text(index++);
    });
  }
  
  $("#search-input").on("keyup", filterProducts);
  $("#status-filter").on("change", filterProducts);
  $("#type-filter").on("change", filterProducts);
  
  $("#clear-filters").on("click", function() {
    $("#search-input").val("");
    $("#status-filter").val("");
    $("#type-filter").val("");
    filterProducts();
  });
});

$("#process-btn").on("click", () => {
  $("#product-form-card").slideToggle(500);
  $("#process-btn").hide();
});

$("#cancel-btn, #cancel-btn-footer").on("click", () => {
  $("#product-form-card").slideToggle(400);
  $("#process-btn").show();
});

$(".new-product-status").on("change", async function (e) {
  const id = e.target.id;
  const productStatus = $(`#${id}.new-product-status`).val();

  try {
    const response = await axios.post(`/admin/product/${id}`, {
      productStatus: productStatus,
    });
    console.log("response", response);
    const result = response.data;
    if (result.data) {
      $(".new-product-status").blur();
    } else alert("Holatni saqlab boʻlmadi. Qaytadan urinib koʻring.");
  } catch (err) {
    console.log(err);
    alert("Holatni saqlab boʻlmadi. Qaytadan urinib koʻring.");
  }
});

/** Returns an error message, or "" when the sale price is valid */
function discountError(price, discount) {
  if (discount === "" || discount === undefined || discount === null) return "";
  return Number(discount) < Number(price) ? "" : "Chegirma narxi asosiy narxdan kichik boʻlishi kerak.";
}

function validateForm() {
  const required = [
    $(".product-name").val(),
    $(".product-author").val(),
    $(".product-price").val(),
    $(".product-left-count").val(),
    $(".product-collection").val(),
    $(".product-desc").val(),
    $(".product-status").val(),
  ];

  if (required.some((value) => !String(value || "").trim())) {
    alert("Majburiy maydonlarni toʻldiring: nom, muallif, narx, zaxira va tavsif.");
    return false;
  }
  const error = discountError($(".product-price").val(), $(".product-discount-price").val());
  if (error) {
    alert(error);
    return false;
  }
  return true;
}

/** EDIT MODAL **/
const EDIT_FIELDS = [
  "productName", "productAuthor", "productPrice", "productDiscountPrice", "productLeftCount",
  "productCollection", "productLanguage", "productIsbn", "productPublisher",
  "productPublishYear", "productPages", "productDesc",
];

$(function () {
  const modalEl = document.getElementById("edit-product-modal");
  if (!modalEl) return;
  const modal = new bootstrap.Modal(modalEl);
  const $form = $("#edit-product-form");
  const $error = $("#edit-product-error");

  $(".edit-product-btn").on("click", function () {
    const product = $(this).data("product"); // jQuery parses the JSON attribute
    $form.find("[name=_id]").val(product._id);
    EDIT_FIELDS.forEach((field) => {
      const value = product[field];
      $form.find(`[name=${field}]`).val(value === undefined || value === null ? "" : value);
    });
    if (!product.productLanguage) $form.find("[name=productLanguage]").val("UZ");
    const shelves = product.productShelves || [];
    $("#edit-shelves input[type=checkbox]").each(function () {
      this.checked = shelves.includes(this.value);
    });
    $error.addClass("d-none").text("");
    modal.show();
  });

  $form.on("submit", async function (e) {
    e.preventDefault();
    const id = $form.find("[name=_id]").val();
    // Every field is sent; empty optional fields clear the stored value
    const body = {};
    EDIT_FIELDS.forEach((field) => {
      body[field] = String($form.find(`[name=${field}]`).val() ?? "").trim();
    });
    body.productShelves = $("#edit-shelves input:checked").map(function () { return this.value; }).get();

    const error =
      (!body.productName || !body.productAuthor || body.productPrice === "" || body.productLeftCount === ""
        ? "Nom, muallif, narx va zaxira majburiy."
        : "") || discountError(body.productPrice, body.productDiscountPrice);
    if (error) {
      $error.removeClass("d-none").text(error);
      return;
    }

    const $save = $("#edit-product-save").prop("disabled", true);
    try {
      await axios.post(`/admin/product/${id}`, body);
      location.reload();
    } catch (err) {
      const message = err?.response?.data?.message || "Saqlab boʻlmadi. Qaytadan urinib koʻring.";
      $error.removeClass("d-none").text(message);
    } finally {
      $save.prop("disabled", false);
    }
  });
});

function previewFileHandler(input, order) {
  const file = input.files[0];
  if (!file) return;

  const validImageType = ["image/jpg", "image/jpeg", "image/png", "image/webp"];
  if (!validImageType.includes(file.type)) {
    alert("Faqat JPG, PNG yoki WEBP rasm (5 MB gacha).");
    input.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = function () {
    const imgEl = $(`#image-section-${order}`);
    imgEl.attr("src", reader.result);
    imgEl.closest(".upload-box").addClass("has-image");
  };
  reader.readAsDataURL(file);
}

// Dashboard's "Yangi kitob" link opens the create form directly
$(function () {
  if (location.hash === "#new") $("#process-btn").trigger("click");
});
