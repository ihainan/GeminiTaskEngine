const outputDiv = document.getElementById('output');

window.electronAPI.onFileOpened((filePath) => {
  outputDiv.innerHTML = `<h3>Output</h3><p>Opened file: ${filePath}</p>`;
  // Simulate the output of the original application
  outputDiv.innerHTML += "<pre>GMRES Iteration: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20\n" +
                         "GMRES Iteration: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20\n" +
                         "GMRES Iteration: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20\n" +
                         "GMRES Iteration: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20\n" +
                         "GMRES Iteration: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20\n" +
                         "Capacitance matrix is:\n" +
                         "Dimension 30 x 30\n" +
                         "1 1.48958e-009 -1.65965e-012 -2.77457e-012 -3.55555e-012 1.91953e-012 -\n" +
                         "1.03506e-012 -1.43633e-012 4.25822e-013 2.61491e-013 2.2636e-013 -1.98869e-\n" +
                         "012 -4.92669e-012 9.29452e-012 7.38568e-013 -3.70903e-013 -1.17285e-010 -\n" +
                         "</pre>";
});
