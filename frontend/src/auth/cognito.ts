import { Amplify } from "aws-amplify";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: "us-east-1_ZS4MbbMgy",
      userPoolClientId: "6pr07jbhi2htkretkl73drp06o",

      loginWith: {
        oauth: {
          domain:
            "us-east-1zs4mbbmgy.auth.us-east-1.amazoncognito.com",

          scopes: ["openid", "email"],

          redirectSignIn: [
            "http://localhost:5173/auth/callback",
          ],

          redirectSignOut: [
            "http://localhost:5173/",
          ],

          responseType: "code",
        },
      },
    },
  },
});
