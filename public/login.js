const form =
    document.getElementById("loginForm");

const errorBox =
    document.getElementById("loginError");


form.addEventListener(
    "submit",
    async event => {

        event.preventDefault();


        const username =
            document.getElementById(
                "username"
            ).value.trim();


        const password =
            document.getElementById(
                "password"
            ).value;


        errorBox.textContent = "";


        try {

            const response =
                await fetch(
                    "/api/login",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            username,
                            password
                        })
                    }
                );


            const data =
                await response.json();


            if (!response.ok) {

                errorBox.textContent =
                    data.error ||
                    "Login failed";

                return;
            }


            if (
                data.user.role ===
                "boss"
            ) {

                window.location.href =
                    "/boss.html";

            } else {

                window.location.href =
                    "/manager.html";
            }

        } catch (error) {

            errorBox.textContent =
                "Unable to connect to server.";
        }
    }
);