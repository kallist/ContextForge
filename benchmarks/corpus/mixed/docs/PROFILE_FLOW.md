# Profile flow

The frontend `ProfileStore` calls `ApiClient`, which speaks the checked-in profile contract. The backend `ProfileRoutes` delegates to `ProfileService`; updates must invalidate `ProfileCache` before publishing the replacement.
