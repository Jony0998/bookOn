console.log("Products frontend javascript file");

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
    } else alert("Product Update failed!");
  } catch (err) {
    console.log(err);
    alert("Product Update failed!");
  }
});

function validateForm() {
  const productName = $(".product-name").val();
  const productPrice = $(".product-price").val();
  const productLeftCount = $(".product-left-count").val();
  const productCollection = $(".product-collection").val();
  const productDesc = $(".product-desc").val();
  const productStatus = $(".product-status").val();

  if (
    productName === "" ||
    productPrice === "" ||
    productLeftCount === "" ||
    productCollection === "" ||
    productDesc === "" ||
    productStatus === ""
  ) {
    alert("Please insert all details!!!");
    return false;
  } else return true;
}

function previewFileHandler(input, order) {
  const imgClassName = input.className;

  const file = $(`.${imgClassName}`).get(0).files[0];
  const fileType = file["type"];
  const validImageType = ["image/jpg", "image/jpeg", "image/png"];

  if (!validImageType.includes(fileType)) {
    alert("Please insert only jpeg, jpg and png");
  } else {
    if (file) {
      const reader = new FileReader();
      reader.onload = function () {
        const imgEl = $(`#image-section-${order}`);
        imgEl.attr("src", reader.result);
        imgEl.closest(".upload-box").addClass("has-image");
      };
      reader.readAsDataURL(file);
    }
  }
}
