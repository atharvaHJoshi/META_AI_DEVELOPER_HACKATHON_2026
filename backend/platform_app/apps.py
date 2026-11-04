from django.apps import AppConfig
from django.db.models import Model
from django.utils import timezone


class PlatformAppConfig(AppConfig):
    name = "platform_app"
    verbose_name = "MIRAIWERK Platform"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self) -> None:
        # Imported here: touching django.contrib.auth.models during app
        # discovery would run before the app registry is ready.
        from django.contrib.auth.signals import user_logged_in

        # Django's built-in receiver writes ``last_login``, a column this
        # product schema does not have (it uses ``last_login_at``). Replace it
        # with a receiver that updates the real column without changing the
        # product's password hashing or session semantics.
        user_logged_in.disconnect(dispatch_uid="update_last_login")

        def record_last_login(sender, user: Model, **kwargs) -> None:
            if hasattr(user, "last_login_at"):
                type(user).objects.filter(pk=user.pk).update(last_login_at=timezone.now())

        user_logged_in.connect(record_last_login, dispatch_uid="platform_app.last_login_at")
