package app.logbookjournal.android

import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // A preview build's page can be inspected over USB, which the emulator test
    // (apps/desktop/e2e/android.ts) uses. Never in a release (app/build.gradle.kts).
    if (BuildConfig.LOGBOOK_PREVIEW) WebView.setWebContentsDebuggingEnabled(true)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * Keeps the page clear of the status bar, the navigation bar, a camera cut-out and the keyboard
   * (D90). Android draws the app edge to edge, and neither Tauri nor the webview makes room for
   * them: margins shrink the webview instead (it ignores padding), and the window's background,
   * the page's paper colour, shows behind the bars.
   */
  override fun onWebViewCreate(webView: WebView) {
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val room = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
      (view.layoutParams as? ViewGroup.MarginLayoutParams)?.let { params ->
        if (params.leftMargin != room.left || params.topMargin != room.top || params.rightMargin != room.right || params.bottomMargin != room.bottom) {
          params.setMargins(room.left, room.top, room.right, room.bottom)
          view.layoutParams = params
        }
      }
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(webView)
  }
}
