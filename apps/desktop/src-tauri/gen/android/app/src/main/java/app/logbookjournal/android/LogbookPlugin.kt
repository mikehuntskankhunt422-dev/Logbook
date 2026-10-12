package app.logbookjournal.android

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class DocumentArgs {
  lateinit var uri: String
}

/**
 * What the Android app needs that Tauri's plugins don't do (D90), called from src-tauri/src/android.rs:
 * printing the page (the PDF export), and writing the file Android's save dialog created, which is
 * a content:// address rather than a path: opening it, its name, and deleting it again when a save
 * is called off.
 *
 * Commands arrive on the main thread. The document ones may wait on a provider (Google Drive), so
 * they run on a thread of their own and answer from there, leaving the screen responsive.
 */
@TauriPlugin
class LogbookPlugin(private val activity: Activity) : Plugin(activity) {
  private var webView: WebView? = null

  override fun load(webView: WebView) {
    this.webView = webView
  }

  /** Android's print screen for the page, with "Save as PDF". The page has laid the entries out for print. */
  @Command
  fun print(invoke: Invoke) {
    val view = webView ?: return invoke.reject("The page isn't ready yet.")
    activity.runOnUiThread {
      try {
        val manager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
        manager.print("Logbook", view.createPrintDocumentAdapter("Logbook"), PrintAttributes.Builder().build())
        invoke.resolve()
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  private fun inBackground(invoke: Invoke, work: () -> Unit) {
    Thread {
      try {
        work()
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }.start()
  }

  /** A file descriptor for writing the document from its start; Rust owns and closes it. */
  @Command
  fun openForWriting(invoke: Invoke) {
    val args = invoke.parseArgs(DocumentArgs::class.java)
    val uri = Uri.parse(args.uri)
    inBackground(invoke) {
      // "wt" empties the document first; some providers only know "w".
      val file = try {
        activity.contentResolver.openFileDescriptor(uri, "wt")
      } catch (e: IllegalArgumentException) {
        activity.contentResolver.openFileDescriptor(uri, "w")
      } catch (e: UnsupportedOperationException) {
        activity.contentResolver.openFileDescriptor(uri, "w")
      }
      if (file == null) {
        invoke.reject("Android couldn't open the file for writing.")
      } else {
        invoke.resolve(JSObject().put("fd", file.detachFd()))
      }
    }
  }

  /** The document's name as the person sees it (they may have changed the one suggested). */
  @Command
  fun displayName(invoke: Invoke) {
    val args = invoke.parseArgs(DocumentArgs::class.java)
    inBackground(invoke) {
      val name = try {
        activity.contentResolver.query(Uri.parse(args.uri), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) cursor.getString(0) else null
        }
      } catch (e: Exception) {
        null
      }
      invoke.resolve(if (name == null) JSObject() else JSObject().put("name", name))
    }
  }

  /** Deletes a document the save dialog created for a save that was then called off. */
  @Command
  fun deleteDocument(invoke: Invoke) {
    val args = invoke.parseArgs(DocumentArgs::class.java)
    inBackground(invoke) {
      val deleted = try {
        DocumentsContract.deleteDocument(activity.contentResolver, Uri.parse(args.uri))
      } catch (e: Exception) {
        false
      }
      invoke.resolve(JSObject().put("deleted", deleted))
    }
  }
}
