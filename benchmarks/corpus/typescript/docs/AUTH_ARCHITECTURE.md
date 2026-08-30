# Authentication architecture

`AuthService` owns login and logout orchestration. `SessionStore` is the revocation truth, while `TokenService` must reject a token when its session is revoked. The HTTP adapter delegates session revocation to the application service.
