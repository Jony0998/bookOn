// Admin: library signup form

$(function () {
  const fileTarget = $(".file-box .upload-hidden");
  let fileName;

  fileTarget.on("change", function () {
    if (window.FileReader) {
      const uploadFile = $(this)[0].files[0],
       fileType = uploadFile["type"],
       validImageType = ["image/jpg", "image/jpeg", "image/png", "image/webp"];
      if (!validImageType.includes(fileType)) {
        alert("Faqat JPG, PNG yoki WEBP rasm.");
        return false;
      } else {
        if (uploadFile) {
          $(".upload-img-frame")
            .attr("src", URL.createObjectURL(uploadFile))
            .addClass("success");
        }
        fileName = $(this)[0].files[0].name;
      }
      $(this).siblings(".upload-name").val(fileName);
    }
  });
});

function validateSignupForm() {
  const memberNick = $(".member-nick").val();
   memberPhone = $(".member-phone").val(),
   memberPassword = $(".member-password").val(),
   confirmPassword = $(".confirm-password").val();

  if (
    memberNick === "" ||
    memberPhone === "" ||
    memberPassword === "" ||
    confirmPassword === ""
  ) {
    alert("Barcha majburiy maydonlarni toʻldiring.");
    return false;
  }

  if (memberPassword !== confirmPassword) {
    alert("Parollar mos kelmadi.");
    return false;
  }


  const file = $(".member-image").get(0).files[0];
  const memberImage = file ? file.name : null;
if (!memberImage) {
  alert("Kutubxona logotipini tanlang.");
  return false;
}
}


